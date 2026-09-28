import {
  formatSyncSummary,
  syncCatalogSets,
  syncedSetCodes,
  type SyncProgress,
} from "@tcg-vault/db";
import { REFERENCE_LANGUAGE_CODE } from "@tcg-vault/shared";

export type SyncEvent =
  | SyncProgress
  | { type: "log"; line: string }
  | { type: "summary"; ok: boolean; lines: string[] }
  | { type: "error"; message: string };

// One sync at a time (Sync page, nightly job): two runs would race on the
// same upserts. Module state lives for the whole server process.
let running = false;

export function syncInProgress(): boolean {
  return running;
}

/**
 * Runs a catalog/price sync for `codes` (or every synced set when null),
 * reporting through `emit`. Never throws: failures become an "error" or a
 * summary with ok: false.
 */
export async function runSync(
  codes: string[] | null,
  emit: (e: SyncEvent) => void,
  languageCode: string = REFERENCE_LANGUAGE_CODE,
): Promise<boolean> {
  if (running) {
    emit({ type: "error", message: "A sync is already running — wait for it to finish." });
    return false;
  }
  running = true;
  try {
    const targets = codes ?? (await syncedSetCodes());
    if (targets.length === 0) {
      emit({
        type: "error",
        message: codes ? "Pick at least one set, or type its code." : "No sets synced yet.",
      });
      return false;
    }
    const result = await syncCatalogSets(
      targets,
      {
        log: (line) => emit({ type: "log", line }),
        onProgress: emit,
      },
      languageCode,
    );
    const ok = result.errors.length === 0 && result.unknownCodes.length === 0;
    emit({ type: "summary", ok, lines: formatSyncSummary(result) });
    return ok;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({
      type: "error",
      message: `Sync failed: ${message}. Check your internet connection — sets and prices come from api.tcgdex.net.`,
    });
    return false;
  } finally {
    running = false;
  }
}
