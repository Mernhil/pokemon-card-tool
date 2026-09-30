"use server";

import {
  CATALOG_JOB,
  type CatalogSetIssue,
  catalogSyncStatus,
  getJobProgress,
  isLocked,
  lockName,
  retryFailedItems,
} from "@tcg-vault/db";
import { catalogAdapters, requestCatalogSync } from "../../lib/background";

/** A set that isn't synced, for the sidebar tooltip and the Sync page. */
export interface SetIssue {
  code: string;
  name: string | null;
  /** Plain-language explanation. */
  message: string;
  /** The raw error, for the curious. */
  error: string | null;
  attempts: number;
  /** ISO timestamp of the last attempt. */
  lastAttemptAt: string | null;
}

export interface CatalogStatus {
  game: string;
  /** Sets the sync knows about, not counting the ones the source can't provide. */
  total: number;
  done: number;
  pending: number;
  /** Real problems only: our bugs and transient errors. Source gaps are in `unavailableSets`. */
  failed: number;
  running: boolean;
  /** Sets being synced right now. */
  current: string[];
  failures: SetIssue[];
  /** Sets the source genuinely can't provide (not failures). */
  unavailableSets: SetIssue[];
}

const toIssue = (i: CatalogSetIssue): SetIssue => ({
  code: i.code,
  name: i.name,
  message: i.message,
  error: i.error,
  attempts: i.attempts,
  lastAttemptAt: i.lastAttemptAt ? i.lastAttemptAt.toISOString() : null,
});

/**
 * Background catalog sync progress for every game, for the sidebar
 * indicator and the Sync page. Reads SyncState (so it also reflects a CLI
 * run) plus this process's in-memory "what's being synced right now".
 */
export async function getSyncStatusAction(): Promise<CatalogStatus[]> {
  return Promise.all(
    catalogAdapters().map(async ({ game }) => {
      const status = await catalogSyncStatus(game);
      const progress = getJobProgress(CATALOG_JOB, game);
      const running =
        (progress?.running ?? false) || (await isLocked(lockName(CATALOG_JOB, game), 120_000));
      return {
        game,
        total: status.total - status.unavailable,
        done: status.done,
        pending: status.pending + status.syncing,
        failed: status.failed,
        running,
        current: progress?.running ? progress.current.map((c) => c.label ?? c.key) : [],
        failures: status.failures.map(toIssue),
        unavailableSets: status.unavailableSets.map(toIssue),
      };
    }),
  );
}

/**
 * "Retry failed sets": queues them again and starts (or extends) a run.
 * `includeUnavailable` also re-checks the sets parked as unavailable at the source.
 */
export async function retryFailedSetsAction(includeUnavailable = false): Promise<number> {
  let queued = 0;
  for (const { game } of catalogAdapters())
    queued += await retryFailedItems(CATALOG_JOB, game, { includeUnavailable });
  requestCatalogSync();
  return queued;
}

/** Checks for new/stale sets now instead of waiting for the next scheduled run. */
export async function syncNowAction(): Promise<void> {
  requestCatalogSync();
}
