import { randomUUID } from "node:crypto";
import type { SyncStatus } from "@tcg-vault/shared";
import { prisma } from "../client";
import {
  backoffDelay,
  errorMessage,
  isFatal,
  isUnavailable,
  isRetryable as defaultIsRetryable,
  retryAfterMs as defaultRetryAfterMs,
  sleep as defaultSleep,
} from "./backoff";
import { emitJobEvent, type JobRunStatus } from "./events";
import { acquireLock, heartbeatLock, releaseLock } from "./lock";

/**
 * The one background-job pattern in this app. Catalog sync (one item per
 * set) and price refresh (one item per variant x provider) are both just a
 * {@link JobDefinition} run through {@link runJob}:
 *
 * - Per-item state lives in SyncState, so a run can stop at any point (app
 *   closed, crash, network gone) and the next run resumes where it left off.
 *   An item is only marked `done` after `process` returns — it's `process`'s
 *   job to make its own writes atomic (catalog writes a set in one transaction).
 * - A database lock (JobLock) means two runs of the same job never overlap,
 *   even across processes.
 * - Each item gets up to `maxAttempts` tries per run, with exponential backoff
 *   + jitter (or the source's Retry-After). Then it's marked `failed` and the
 *   run moves on; failed items are retried on the next run. One bad item never
 *   blocks the others.
 * - Workers pick the next item from the DB each time (highest priority
 *   first), so items enqueued mid-run are picked up by that same run.
 */

export interface JobItem {
  key: string;
  label?: string | null;
  /** Higher runs first. */
  priority?: number;
}

export interface ClaimedItem {
  key: string;
  label: string | null;
  priority: number;
  /** Status before this run picked it up. */
  previousStatus: SyncStatus;
  lastSyncedAt: Date | null;
}

export interface ProcessContext {
  attempt: number;
  signal: AbortSignal;
  /** Job-specific progress, forwarded on the event bus as a "detail" event. */
  detail: (data: unknown) => void;
}

export interface JobDefinition {
  job: string;
  /** Game.slug, or "*" for a job that isn't per-game. */
  game: string;
  /**
   * Lists the items that should exist (e.g. every set the source has). New
   * ones are added as `pending`; existing ones get label/priority refreshed.
   * A discovery failure is logged and the run continues with known items.
   */
  discover?: () => Promise<JobItem[]>;
  process: (item: ClaimedItem, ctx: ProcessContext) => Promise<void>;
}

export interface JobRunOptions {
  /** Items processed in parallel. Default 2. */
  concurrency?: number;
  /** Pause after each item, per worker, to go easy on the source. Default 500 ms. */
  delayMs?: number;
  /** Tries per item per run. Default 3. */
  maxAttempts?: number;
  /** First backoff ceiling; doubles each retry. Default 2 s. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** `done` items older than this are processed again. Default 30 days. */
  refreshAfterMs?: number;
  /** `unavailable` items are checked again after this long. Default 30 days. */
  unavailableRetryMs?: number;
  /** Only consider these item keys. */
  onlyKeys?: string[];
  /** Stop after this many items. */
  maxItems?: number;
  /**
   * Stop the run after this many items in a row failed for good — when
   * everything fails, the source (or the network) is down and grinding
   * through every remaining item with retries only wastes time. Default 5.
   */
  maxConsecutiveFailures?: number;
  /** Skip `discover` (e.g. when the caller only wants specific items). */
  skipDiscovery?: boolean;
  signal?: AbortSignal;
  log?: (line: string) => void;
  lockStaleMs?: number;
  heartbeatMs?: number;
  // Injectable for tests.
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface JobRunSummary {
  status: JobRunStatus;
  /** Set when `discover` failed (the run still processed the items already known). */
  discoveryError?: string;
  succeeded: string[];
  failed: Array<{ key: string; label: string | null; error: string }>;
  /** Items the source can't provide (not failures); absent on summaries that can't have any. */
  unavailable?: Array<{ key: string; label: string | null; reason: string }>;
}

export const DEFAULT_REFRESH_AFTER_MS = 30 * 86_400_000;
export const DEFAULT_UNAVAILABLE_RETRY_MS = 30 * 86_400_000;

export function lockName(job: string, game: string): string {
  return `job:${job}:${game}`;
}

/**
 * Adds items that don't have a SyncState row yet (as `pending`) and refreshes
 * label/priority on the ones that do — without touching their status.
 */
export async function upsertItems(job: string, game: string, items: JobItem[]): Promise<void> {
  if (items.length === 0) return;
  const existing = await prisma.syncState.findMany({
    where: { job, game },
    select: { itemKey: true, label: true, priority: true },
  });
  const byKey = new Map(existing.map((row) => [row.itemKey, row]));
  const ops = [];
  // A source may list the same key twice (YGOPRODeck reuses set codes): first wins.
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const row = byKey.get(item.key);
    const label = item.label ?? null;
    const priority = item.priority ?? 0;
    if (!row) {
      ops.push(
        prisma.syncState.create({ data: { job, game, itemKey: item.key, label, priority } }),
      );
    } else if ((label !== null && row.label !== label) || row.priority !== priority) {
      ops.push(
        prisma.syncState.update({
          where: { job_game_itemKey: { job, game, itemKey: item.key } },
          data: { label: label ?? row.label, priority },
        }),
      );
    }
  }
  // Chunked so one discovery of thousands of items isn't one giant transaction.
  for (let i = 0; i < ops.length; i += 200) {
    await prisma.$transaction(ops.slice(i, i + 200));
  }
}

/**
 * Queues items to run as soon as possible: creates them if needed and sets
 * them `pending` with at least `priority`. Used for "sync this set now",
 * "retry failed", and "this card's prices are stale".
 */
export async function enqueueItems(
  job: string,
  game: string,
  items: JobItem[],
  priority: number,
): Promise<void> {
  for (const item of items) {
    await prisma.syncState.upsert({
      where: { job_game_itemKey: { job, game, itemKey: item.key } },
      create: {
        job,
        game,
        itemKey: item.key,
        label: item.label ?? null,
        priority,
        status: "pending",
      },
      update: { status: "pending", priority, ...(item.label ? { label: item.label } : {}) },
    });
  }
}

/**
 * Marks every `failed` item of a job `pending` again. Returns how many.
 * `includeUnavailable` also re-checks items parked as unavailable at the source.
 */
export async function retryFailedItems(
  job: string,
  game: string,
  { includeUnavailable = false } = {},
): Promise<number> {
  const res = await prisma.syncState.updateMany({
    where: {
      job,
      game,
      status: { in: includeUnavailable ? ["failed", "unavailable"] : ["failed"] },
    },
    data: { status: "pending", attemptCount: 0 },
  });
  return res.count;
}

export async function runJob(
  def: JobDefinition,
  options: JobRunOptions = {},
): Promise<JobRunSummary> {
  const {
    concurrency = 2,
    delayMs = 500,
    maxAttempts = 3,
    backoffBaseMs = 2_000,
    backoffMaxMs = 60_000,
    refreshAfterMs = DEFAULT_REFRESH_AFTER_MS,
    unavailableRetryMs = DEFAULT_UNAVAILABLE_RETRY_MS,
    maxConsecutiveFailures = 5,
    lockStaleMs = 120_000,
    heartbeatMs = 20_000,
    now = () => new Date(),
    sleep = defaultSleep,
    random = Math.random,
    log = () => {},
  } = options;
  const { job, game } = def;
  const summary: JobRunSummary = {
    status: "completed",
    succeeded: [],
    failed: [],
    unavailable: [],
  };

  const lock = lockName(job, game);
  const holder = `${process.pid}:${randomUUID()}`;
  if (!(await acquireLock(lock, holder, { now: now(), staleMs: lockStaleMs }))) {
    summary.status = "locked";
    emitJobEvent({ job, game, type: "run-end", status: "locked", succeeded: 0, failed: 0 });
    return summary;
  }

  const heartbeat = setInterval(() => {
    heartbeatLock(lock, holder).catch((err) => log(`heartbeat failed: ${errorMessage(err)}`));
  }, heartbeatMs);
  heartbeat.unref?.();

  const internal = new AbortController();
  const abortRun = () => internal.abort();
  options.signal?.addEventListener("abort", abortRun);
  if (options.signal?.aborted) internal.abort();

  emitJobEvent({ job, game, type: "run-start" });
  try {
    // We hold the lock, so anything still "syncing" was left by a run that
    // died mid-item. Its writes were rolled back (or never committed), so it
    // simply needs doing again.
    const interrupted = await prisma.syncState.updateMany({
      where: { job, game, status: "syncing" },
      data: {
        status: "failed",
        lastError: "Interrupted before it finished (app closed or crashed).",
      },
    });
    if (interrupted.count > 0)
      log(`${interrupted.count} item(s) were interrupted last time; retrying them.`);

    if (def.discover && !options.skipDiscovery) {
      try {
        await upsertItems(job, game, await def.discover());
      } catch (err) {
        summary.discoveryError = errorMessage(err);
        log(
          `couldn't list items (${summary.discoveryError}); continuing with the ones already known.`,
        );
      }
    }

    const runStart = now();
    let claimed = 0;
    let consecutiveFailures = 0;

    const claimNext = async (): Promise<ClaimedItem | null> => {
      if (internal.signal.aborted) return null;
      if (options.maxItems !== undefined && claimed >= options.maxItems) return null;
      const staleBefore = new Date(now().getTime() - refreshAfterMs);
      const unavailableBefore = new Date(now().getTime() - unavailableRetryMs);
      // Retry on a lost race with another worker.
      for (let i = 0; i < 5; i++) {
        const row = await prisma.syncState.findFirst({
          where: {
            job,
            game,
            ...(options.onlyKeys ? { itemKey: { in: options.onlyKeys } } : {}),
            // Not already tried in this run (failed items wait for the next run).
            OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: runStart } }],
            AND: [
              {
                OR: [
                  { status: { in: ["pending", "failed"] } },
                  { status: "unavailable", lastAttemptAt: { lt: unavailableBefore } },
                  {
                    status: "done",
                    OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
                  },
                ],
              },
            ],
          },
          orderBy: [{ priority: "desc" }, { id: "asc" }],
        });
        if (!row) return null;
        const taken = await prisma.syncState.updateMany({
          where: { id: row.id, status: row.status, lastAttemptAt: row.lastAttemptAt },
          data: { status: "syncing", lastAttemptAt: now() },
        });
        if (taken.count === 1) {
          claimed++;
          return {
            key: row.itemKey,
            label: row.label,
            priority: row.priority,
            previousStatus: row.status as SyncStatus,
            lastSyncedAt: row.lastSyncedAt,
          };
        }
      }
      return null;
    };

    const where = (key: string) => ({ job_game_itemKey: { job, game, itemKey: key } });

    const processItem = async (item: ClaimedItem) => {
      emitJobEvent({ job, game, type: "item-start", key: item.key, label: item.label });
      for (let attempt = 1; ; attempt++) {
        try {
          await def.process(item, {
            attempt,
            signal: internal.signal,
            detail: (data) => emitJobEvent({ job, game, type: "detail", key: item.key, data }),
          });
          await prisma.syncState.update({
            where: where(item.key),
            data: { status: "done", lastSyncedAt: now(), attemptCount: 0, lastError: null },
          });
          summary.succeeded.push(item.key);
          consecutiveFailures = 0;
          emitJobEvent({ job, game, type: "item-done", key: item.key, label: item.label });
          return;
        } catch (err) {
          const error = errorMessage(err);
          if (isUnavailable(err)) {
            await prisma.syncState.update({
              where: where(item.key),
              data: {
                status: "unavailable",
                lastError: error.slice(0, 2_000),
                lastAttemptAt: now(),
                attemptCount: { increment: 1 },
              },
            });
            summary.unavailable?.push({ key: item.key, label: item.label, reason: error });
            // Says nothing about the source being down: doesn't count towards halting.
            consecutiveFailures = 0;
            emitJobEvent({
              job,
              game,
              type: "item-unavailable",
              key: item.key,
              label: item.label,
              reason: error,
            });
            log(`${item.label ?? item.key} is unavailable at the source: ${error}`);
            return;
          }
          const fatal = isFatal(err);
          const final =
            fatal || attempt >= maxAttempts || !defaultIsRetryable(err) || internal.signal.aborted;
          await prisma.syncState.update({
            where: where(item.key),
            data: {
              attemptCount: { increment: 1 },
              lastError: error.slice(0, 2_000),
              lastAttemptAt: now(),
              ...(final ? { status: "failed" } : {}),
            },
          });
          if (final) {
            summary.failed.push({ key: item.key, label: item.label, error });
            emitJobEvent({
              job,
              game,
              type: "item-failed",
              key: item.key,
              label: item.label,
              error,
            });
            log(`${item.label ?? item.key} failed: ${error}`);
            if (fatal) {
              // e.g. bad credentials: every other item would fail the same way.
              log(`stopping this run: ${error}`);
              summary.status = "halted";
              internal.abort();
            } else if (++consecutiveFailures >= maxConsecutiveFailures) {
              log(
                `${consecutiveFailures} items in a row failed — stopping this run; the rest stay queued.`,
              );
              summary.status = "halted";
              internal.abort();
            }
            return;
          }
          const waitMs =
            defaultRetryAfterMs(err) ?? backoffDelay(attempt, backoffBaseMs, backoffMaxMs, random);
          emitJobEvent({
            job,
            game,
            type: "item-retry",
            key: item.key,
            label: item.label,
            attempt,
            waitMs,
            error,
          });
          log(
            `${item.label ?? item.key}: attempt ${attempt} failed (${error}); retrying in ${(waitMs / 1000).toFixed(1)}s`,
          );
          await sleep(waitMs);
        }
      }
    };

    const worker = async () => {
      for (;;) {
        const item = await claimNext();
        if (!item) return;
        await processItem(item);
        if (delayMs > 0 && !internal.signal.aborted) await sleep(delayMs);
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
    if (summary.status === "completed" && options.signal?.aborted) summary.status = "aborted";
    return summary;
  } finally {
    clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", abortRun);
    await releaseLock(lock, holder).catch((err) =>
      log(`couldn't release lock: ${errorMessage(err)}`),
    );
    emitJobEvent({
      job,
      game,
      type: "run-end",
      status: summary.status,
      succeeded: summary.succeeded.length,
      failed: summary.failed.length,
    });
  }
}

export interface JobStateCounts {
  total: number;
  pending: number;
  syncing: number;
  done: number;
  failed: number;
  unavailable: number;
}

/** SyncState counts by status for one job, for progress UIs. */
export async function jobStateCounts(job: string, game?: string): Promise<JobStateCounts> {
  const groups = await prisma.syncState.groupBy({
    by: ["status"],
    where: { job, ...(game ? { game } : {}) },
    _count: { _all: true },
  });
  const counts: JobStateCounts = {
    total: 0,
    pending: 0,
    syncing: 0,
    done: 0,
    failed: 0,
    unavailable: 0,
  };
  for (const g of groups) {
    const n = g._count._all;
    counts.total += n;
    if (g.status in counts) counts[g.status as keyof Omit<JobStateCounts, "total">] += n;
  }
  return counts;
}
