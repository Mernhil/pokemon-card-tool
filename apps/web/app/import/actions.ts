"use server";

import {
  commitImport,
  matchImportRows,
  snapshotPortfolio,
  type ImportItem,
  type MatchedImportRow,
} from "@tcg-vault/db";
import { parseCollectionCsv } from "@tcg-vault/shared";
import { revalidatePath } from "next/cache";

const MAX_ROWS = 5_000;

export interface ImportPreview {
  rows: MatchedImportRow[];
  warnings: string[];
  /** True when the file had more rows than we read. */
  truncated: boolean;
}

/** Reads a tracker's CSV and matches every row to the catalog. Nothing is saved. */
export async function previewImportAction(
  text: string,
): Promise<{ ok: true; preview: ImportPreview } | { ok: false; error: string }> {
  try {
    if (text.length > 5_000_000) return { ok: false, error: "That file is too large (over 5 MB)." };
    const parsed = parseCollectionCsv(text);
    if (parsed.rows.length === 0)
      return { ok: false, error: parsed.warnings[0] ?? "No cards found in the file." };
    const rows = parsed.rows.slice(0, MAX_ROWS);
    return {
      ok: true,
      preview: {
        rows: await matchImportRows(rows),
        warnings: parsed.warnings,
        truncated: parsed.rows.length > rows.length,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Saves the rows the user confirmed. */
export async function commitImportAction(
  items: ImportItem[],
): Promise<{ ok: true; copies: number } | { ok: false; error: string }> {
  try {
    const copies = await commitImport(items.slice(0, MAX_ROWS));
    await snapshotPortfolio();
    revalidatePath("/", "layout");
    return { ok: true, copies };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
