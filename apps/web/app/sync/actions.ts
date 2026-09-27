"use server";

import { revalidatePath } from "next/cache";
import { formatSyncSummary, syncCatalogSets, syncedSetCodes } from "@tcg-vault/db";

export interface SyncState {
  ok: boolean;
  lines: string[];
}

// One sync at a time: two concurrent runs would race on the same upserts.
let running = false;

async function run(codes: string[]): Promise<SyncState> {
  if (codes.length === 0) {
    return { ok: false, lines: ["Pick at least one set, or type its code."] };
  }
  if (running) {
    return { ok: false, lines: ["A sync is already running — wait for it to finish."] };
  }
  running = true;
  const log: string[] = [];
  try {
    const result = await syncCatalogSets(codes, { log: (line) => log.push(line) });
    revalidatePath("/", "layout");
    return {
      ok: result.errors.length === 0 && result.unknownCodes.length === 0,
      lines: [...log, "", ...formatSyncSummary(result)],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      lines: [
        ...log,
        `Sync failed: ${message}`,
        "Check your internet connection — sets and prices come from api.tcgdex.net.",
      ],
    };
  } finally {
    running = false;
  }
}

export async function syncSetsAction(
  _prev: SyncState | null,
  formData: FormData,
): Promise<SyncState> {
  const picked = formData.getAll("code").map(String);
  const typed = String(formData.get("codes") ?? "")
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  return run([...new Set([...picked, ...typed])]);
}

export async function refreshPricesAction(_prev: SyncState | null): Promise<SyncState> {
  return run(await syncedSetCodes());
}
