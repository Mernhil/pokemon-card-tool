import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/client";
import { NonRetryableError, backoffDelay } from "../src/jobs/backoff";
import { acquireLock } from "../src/jobs/lock";
import {
  enqueueItems,
  lockName,
  retryFailedItems,
  runJob,
  upsertItems,
  type JobDefinition,
  type JobRunOptions,
} from "../src/jobs/runner";
import { fakeClock, resetDb } from "./helpers";

const JOB = "test-job";
const GAME = "pokemon";

/** Options that make runs instant and deterministic. */
function fast(clock = fakeClock(), extra: JobRunOptions = {}): JobRunOptions {
  return {
    now: clock.now,
    sleep: async () => {},
    random: () => 1,
    delayMs: 0,
    concurrency: 1,
    ...extra,
  };
}

function def(
  process: JobDefinition["process"],
  discover?: JobDefinition["discover"],
): JobDefinition {
  return { job: JOB, game: GAME, process, discover };
}

async function states() {
  const rows = await prisma.syncState.findMany({
    where: { job: JOB },
    orderBy: { itemKey: "asc" },
  });
  return Object.fromEntries(rows.map((r) => [r.itemKey, r]));
}

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("backoffDelay", () => {
  it("doubles the ceiling per attempt, capped, with jitter below the ceiling", () => {
    expect(backoffDelay(1, 1_000, 60_000, () => 1)).toBe(1_000);
    expect(backoffDelay(2, 1_000, 60_000, () => 1)).toBe(2_000);
    expect(backoffDelay(3, 1_000, 60_000, () => 1)).toBe(4_000);
    expect(backoffDelay(10, 1_000, 60_000, () => 1)).toBe(60_000);
    // Full jitter, but never an instant retry.
    expect(backoffDelay(3, 1_000, 60_000, () => 0.5)).toBe(2_000);
    expect(backoffDelay(3, 1_000, 60_000, () => 0)).toBe(400);
  });
});

describe("runJob", () => {
  it("discovers items and processes them highest priority first, marking them done", async () => {
    const seen: string[] = [];
    const summary = await runJob(
      def(
        async (item) => {
          seen.push(item.key);
        },
        async () => [
          { key: "old", label: "Old set", priority: 1 },
          { key: "new", label: "New set", priority: 3 },
          { key: "mid", label: "Mid set", priority: 2 },
        ],
      ),
      fast(),
    );
    expect(summary.status).toBe("completed");
    expect(seen).toEqual(["new", "mid", "old"]);
    const s = await states();
    expect(Object.values(s).map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(s.new!.label).toBe("New set");
    expect(s.new!.lastSyncedAt).not.toBeNull();
  });

  it("keeps going when one item fails, and records the failure", async () => {
    await upsertItems(JOB, GAME, [
      { key: "a", priority: 3 },
      { key: "broken", priority: 2 },
      { key: "c", priority: 1 },
    ]);
    const summary = await runJob(
      def(async (item) => {
        if (item.key === "broken") throw new Error("HTTP 500 from source");
      }),
      fast(undefined, { maxAttempts: 3 }),
    );
    expect(summary.succeeded).toEqual(["a", "c"]);
    expect(summary.failed).toEqual([{ key: "broken", label: null, error: "HTTP 500 from source" }]);
    const s = await states();
    expect(s.a!.status).toBe("done");
    expect(s.c!.status).toBe("done");
    expect(s.broken!.status).toBe("failed");
    expect(s.broken!.attemptCount).toBe(3);
    expect(s.broken!.lastError).toBe("HTTP 500 from source");
  });

  it("retries with exponential backoff, then succeeds and resets the attempt count", async () => {
    await upsertItems(JOB, GAME, [{ key: "flaky" }]);
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    await runJob(
      def(async () => {
        if (++calls < 3) throw new Error("timeout");
      }),
      { ...fast(), sleep, backoffBaseMs: 1_000, backoffMaxMs: 60_000, maxAttempts: 3 },
    );
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
    const s = await states();
    expect(s.flaky!.status).toBe("done");
    expect(s.flaky!.attemptCount).toBe(0);
    expect(s.flaky!.lastError).toBeNull();
  });

  it("waits as long as the source's Retry-After says instead of its own backoff", async () => {
    await upsertItems(JOB, GAME, [{ key: "limited" }]);
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    await runJob(
      def(async () => {
        if (++calls === 1) throw Object.assign(new Error("429"), { retryAfterMs: 30_000 });
      }),
      { ...fast(), sleep },
    );
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([30_000]);
    expect((await states()).limited!.status).toBe("done");
  });

  it("doesn't retry errors marked non-retryable within the run", async () => {
    await upsertItems(JOB, GAME, [{ key: "gone" }]);
    let calls = 0;
    await runJob(
      def(async () => {
        calls++;
        throw new NonRetryableError("404 not found");
      }),
      fast(),
    );
    expect(calls).toBe(1);
    expect((await states()).gone!.status).toBe("failed");
  });

  it("gives up on a failing item for this run but retries it on the next one", async () => {
    await upsertItems(JOB, GAME, [{ key: "x" }]);
    const clock = fakeClock();
    let calls = 0;
    const failTwiceThenWork = def(async () => {
      if (++calls <= 2) throw new Error("down");
    });

    await runJob(failTwiceThenWork, fast(clock, { maxAttempts: 2 }));
    expect(calls).toBe(2);
    expect((await states()).x!.status).toBe("failed");

    clock.advance(60_000);
    await runJob(failTwiceThenWork, fast(clock, { maxAttempts: 2 }));
    expect(calls).toBe(3);
    const s = await states();
    expect(s.x!.status).toBe("done");
    expect(s.x!.attemptCount).toBe(0);
  });

  it("resumes after a crash: items left 'syncing' are redone, finished items are not", async () => {
    const clock = fakeClock();
    await upsertItems(JOB, GAME, [
      { key: "finished", priority: 3 },
      { key: "mid-crash", priority: 2 },
      { key: "untouched", priority: 1 },
    ]);
    // Simulate a process that finished one item, died halfway through the
    // second (row still "syncing", lock never released), and never got to
    // the third.
    await prisma.syncState.update({
      where: { job_game_itemKey: { job: JOB, game: GAME, itemKey: "finished" } },
      data: { status: "done", lastSyncedAt: clock.now(), lastAttemptAt: clock.now() },
    });
    await prisma.syncState.update({
      where: { job_game_itemKey: { job: JOB, game: GAME, itemKey: "mid-crash" } },
      data: { status: "syncing", lastAttemptAt: clock.now() },
    });
    await acquireLock(lockName(JOB, GAME), "dead-process", { now: clock.now(), staleMs: 120_000 });

    clock.advance(10 * 60_000); // the dead process's lock heartbeat is now stale
    const seen: string[] = [];
    const summary = await runJob(
      def(async (item) => {
        seen.push(item.key);
      }),
      fast(clock),
    );
    expect(summary.status).toBe("completed");
    expect(seen).toEqual(["mid-crash", "untouched"]);
    const s = await states();
    expect(Object.values(s).every((r) => r.status === "done")).toBe(true);
    expect(await prisma.jobLock.count()).toBe(0);
  });

  it("never runs twice at once: a second run while one holds the lock returns 'locked'", async () => {
    await upsertItems(JOB, GAME, [{ key: "a" }, { key: "b" }]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let concurrent = 0;
    let maxConcurrent = 0;
    const slow = def(async () => {
      maxConcurrent = Math.max(maxConcurrent, ++concurrent);
      await gate;
      concurrent--;
    });

    const first = runJob(slow, fast());
    // Wait until the first run is inside `process`.
    await vi.waitFor(() => expect(concurrent).toBe(1));
    const second = await runJob(slow, fast());
    expect(second.status).toBe("locked");
    release();
    expect((await first).status).toBe("completed");
    expect(maxConcurrent).toBe(1);
    // Lock released: a later run can go.
    expect((await runJob(slow, fast())).status).toBe("completed");
  });

  it("takes over a lock whose holder stopped heart-beating", async () => {
    const clock = fakeClock();
    expect(await acquireLock("l", "p1", { now: clock.now(), staleMs: 60_000 })).toBe(true);
    expect(await acquireLock("l", "p2", { now: clock.now(), staleMs: 60_000 })).toBe(false);
    clock.advance(61_000);
    expect(await acquireLock("l", "p2", { now: clock.now(), staleMs: 60_000 })).toBe(true);
    expect((await prisma.jobLock.findUnique({ where: { name: "l" } }))!.holder).toBe("p2");
  });

  it("re-processes done items only once they're older than the refresh interval", async () => {
    const clock = fakeClock();
    const day = 86_400_000;
    await upsertItems(JOB, GAME, [{ key: "fresh" }, { key: "stale" }, { key: "new" }]);
    for (const [key, age] of [
      ["fresh", 5 * day],
      ["stale", 31 * day],
    ] as const) {
      const at = new Date(clock.now().getTime() - age);
      await prisma.syncState.update({
        where: { job_game_itemKey: { job: JOB, game: GAME, itemKey: key } },
        data: { status: "done", lastSyncedAt: at, lastAttemptAt: at },
      });
    }
    const seen: string[] = [];
    const record = def(async (item) => {
      seen.push(item.key);
    });

    await runJob(record, fast(clock, { refreshAfterMs: 30 * day }));
    expect(seen.sort()).toEqual(["new", "stale"]);

    // A shorter interval makes the 5-day-old one stale too.
    seen.length = 0;
    clock.advance(1_000);
    await runJob(record, fast(clock, { refreshAfterMs: 2 * day }));
    expect(seen).toEqual(["fresh"]);
  });

  it("stops early when everything keeps failing (source or network down)", async () => {
    await upsertItems(
      JOB,
      GAME,
      Array.from({ length: 10 }, (_, i) => ({ key: `s${i}`, priority: 10 - i })),
    );
    let calls = 0;
    const summary = await runJob(
      def(async () => {
        calls++;
        throw new Error("getaddrinfo ENOTFOUND");
      }),
      fast(undefined, { maxAttempts: 1, maxConsecutiveFailures: 3 }),
    );
    expect(summary.status).toBe("halted");
    expect(calls).toBe(3);
    const s = await states();
    expect(Object.values(s).filter((r) => r.status === "pending")).toHaveLength(7);
  });

  it("picks up items enqueued while it's running, ahead of lower-priority ones", async () => {
    await upsertItems(JOB, GAME, [
      { key: "a", priority: 3 },
      { key: "b", priority: 2 },
      { key: "c", priority: 1 },
    ]);
    const seen: string[] = [];
    await runJob(
      def(async (item) => {
        seen.push(item.key);
        if (item.key === "a") await enqueueItems(JOB, GAME, [{ key: "urgent" }], 100);
      }),
      fast(),
    );
    expect(seen).toEqual(["a", "urgent", "b", "c"]);
  });

  it("runs several items in parallel up to the concurrency limit", async () => {
    await upsertItems(
      JOB,
      GAME,
      Array.from({ length: 6 }, (_, i) => ({ key: `k${i}` })),
    );
    let inFlight = 0;
    let peak = 0;
    await runJob(
      def(async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 150));
        inFlight--;
      }),
      fast(undefined, { concurrency: 3 }),
    );
    expect(peak).toBe(3);
    expect(Object.values(await states()).every((r) => r.status === "done")).toBe(true);
  });

  it("stops the run at once on a fatal error (e.g. bad credentials)", async () => {
    await upsertItems(JOB, GAME, [
      { key: "a", priority: 3 },
      { key: "b", priority: 2 },
      { key: "c", priority: 1 },
    ]);
    let calls = 0;
    const summary = await runJob(
      def(async () => {
        calls++;
        throw Object.assign(new Error("invalid token"), { fatal: true, retryable: false });
      }),
      fast(),
    );
    expect(summary.status).toBe("halted");
    expect(calls).toBe(1);
    const s = await states();
    expect([s.a!.status, s.b!.status, s.c!.status]).toEqual(["failed", "pending", "pending"]);
  });

  it("retryFailedItems re-queues failed items", async () => {
    await upsertItems(JOB, GAME, [{ key: "a" }]);
    await prisma.syncState.updateMany({ data: { status: "failed", attemptCount: 3 } });
    expect(await retryFailedItems(JOB, GAME)).toBe(1);
    const s = await states();
    expect(s.a!.status).toBe("pending");
    expect(s.a!.attemptCount).toBe(0);
  });
});
