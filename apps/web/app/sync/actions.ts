"use server";

import {
  CATALOG_JOB,
  catalogSyncStatus,
  getJobProgress,
  isLocked,
  lockName,
  retryFailedItems,
} from "@tcg-vault/db";
import { catalogAdapters, requestCatalogSync } from "../../lib/background";

export interface CatalogStatus {
  game: string;
  total: number;
  done: number;
  pending: number;
  failed: number;
  running: boolean;
  /** Sets being synced right now. */
  current: string[];
  failures: Array<{ code: string; name: string | null; error: string | null; attempts: number }>;
}

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
        total: status.total,
        done: status.done,
        pending: status.pending + status.syncing,
        failed: status.failed,
        running,
        current: progress?.running ? progress.current.map((c) => c.label ?? c.key) : [],
        failures: status.failures,
      };
    }),
  );
}

/** "Retry failed sets": queues them again and starts (or extends) a run. */
export async function retryFailedSetsAction(): Promise<number> {
  let queued = 0;
  for (const { game } of catalogAdapters()) queued += await retryFailedItems(CATALOG_JOB, game);
  requestCatalogSync();
  return queued;
}

/** Checks for new/stale sets now instead of waiting for the next scheduled run. */
export async function syncNowAction(): Promise<void> {
  requestCatalogSync();
}
