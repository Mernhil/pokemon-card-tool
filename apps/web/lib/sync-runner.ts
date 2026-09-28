import {
  CATALOG_JOB,
  MANUAL_PRIORITY,
  enqueueItems,
  formatSyncSummary,
  syncCatalogSets,
  syncedSetCodes,
  type SyncProgress,
} from "@tcg-vault/db";
import { catalogAdapter, requestCatalogSync } from "./background";

export type SyncEvent =
  | SyncProgress
  | { type: "log"; line: string }
  | { type: "summary"; ok: boolean; lines: string[] }
  | { type: "error"; message: string };

/**
 * The Sync page's "sync these sets now": runs them through the background
 * catalog job (src/catalog-sync.ts in @tcg-vault/db) at the front of the
 * queue, reporting through `emit`. When a background run is already going,
 * the sets are queued first in it and this follows their progress. Never
 * throws: failures become an "error" or a summary with ok: false.
 *
 * `codes === null` re-queues every synced set (a full catalog refresh) and
 * returns once the background job has been started.
 */
export async function runSync(
  codes: string[] | null,
  emit: (e: SyncEvent) => void,
): Promise<boolean> {
  const adapter = catalogAdapter();
  try {
    if (codes === null) {
      const all = await syncedSetCodes(adapter.game);
      if (all.length === 0) {
        emit({ type: "error", message: "No sets synced yet." });
        return false;
      }
      await enqueueItems(
        CATALOG_JOB,
        adapter.game,
        all.map((key) => ({ key })),
        MANUAL_PRIORITY - 1,
      );
      requestCatalogSync();
      emit({
        type: "summary",
        ok: true,
        lines: [`Queued ${all.length} set(s) for a re-sync in the background.`],
      });
      return true;
    }
    if (codes.length === 0) {
      emit({ type: "error", message: "Pick at least one set, or type its code." });
      return false;
    }
    const result = await syncCatalogSets(
      codes,
      { log: (line) => emit({ type: "log", line }), onProgress: emit },
      adapter,
    );
    const ok = result.errors.length === 0 && result.unknownCodes.length === 0;
    emit({ type: "summary", ok, lines: formatSyncSummary(result) });
    return ok;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({
      type: "error",
      message: `Sync failed: ${message}. Check your internet connection — sets come from api.tcgdex.net.`,
    });
    return false;
  }
}
