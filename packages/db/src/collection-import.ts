import type { ImportRow } from "@tcg-vault/shared";
import { normalizeName, scoreCardMatch, scoreSetMatch } from "@tcg-vault/sources";
import { prisma } from "./client";

/**
 * Matches rows read from another tracker's file (parseCollectionCsv) to
 * catalog variants, with a confidence per candidate, and saves the ones the
 * user confirmed. A card is found by name, then must agree on collector
 * number; the set name/code and language narrow it further. Anything not a
 * clear single winner is left for the user to pick in the review step.
 */

export interface ImportCandidate {
  variantId: string;
  printingId: string;
  name: string;
  number: string;
  setName: string;
  setCode: string;
  finish: string;
  languageCode: string;
  score: number;
  reason: string;
}

export type ImportStatus = "matched" | "review" | "none";

export interface MatchedImportRow {
  row: ImportRow;
  status: ImportStatus;
  /** Best first, at most MAX_CANDIDATES. */
  candidates: ImportCandidate[];
}

export const MAX_CANDIDATES = 6;
const SURE = 0.9;

/** "Charizard - 4/102 (Holo)" -> "Charizard": what to look the card up by. */
export function lookupName(name: string): string {
  return name.replace(/\([^)]*\)/g, " ").split(" - ")[0]!.replace(/\s+/g, " ").trim();
}

type VariantLite = { id: string; finish: string; edition: string; languageCode: string };

/** The variant of a printing a row means, with a note when the finish had to be guessed. */
export function pickVariant(
  variants: VariantLite[],
  row: Pick<ImportRow, "finish" | "foil" | "language">,
): { variant: VariantLite; note: string } | null {
  const lang = row.language ?? "en";
  const pool = variants.filter((v) => v.languageCode === lang && v.edition === "UNLIMITED");
  if (pool.length === 0) return null;
  const has = (f: string) => pool.find((v) => v.finish === f);
  if (row.finish && has(row.finish)) return { variant: has(row.finish)!, note: "" };
  if (row.foil === true) {
    const foil = has("HOLO") ?? has("REVERSE_HOLO") ?? pool.find((v) => v.finish !== "NON_FOIL");
    if (foil) return { variant: foil, note: "" };
    return { variant: pool[0]!, note: "no foil version in the catalog" };
  }
  if (row.foil === false) {
    const plain = has("NON_FOIL");
    return plain ? { variant: plain, note: "" } : { variant: pool[0]!, note: "no non-foil version" };
  }
  const first = has("NON_FOIL") ?? pool[0]!;
  return { variant: first, note: pool.length > 1 ? "finish not in the file" : "" };
}

export async function matchImportRows(
  rows: ImportRow[],
  game = "pokemon",
): Promise<MatchedImportRow[]> {
  const byName = new Map<string, Awaited<ReturnType<typeof printingsNamed>>>();
  const out: MatchedImportRow[] = [];
  for (const row of rows) {
    const key = normalizeName(lookupName(row.name));
    if (!byName.has(key)) byName.set(key, await printingsNamed(lookupName(row.name), game));
    const printings = byName.get(key)!;

    const candidates: ImportCandidate[] = [];
    for (const p of printings) {
      const card = row.number
        ? scoreCardMatch(
            { name: p.card.name, number: p.collectorNumber },
            { name: lookupName(row.name), number: row.number },
          )
        : normalizeName(p.card.name) === key
          ? { score: 0.5, reason: "name only — the file has no card number" }
          : { score: 0, reason: "" };
      if (card.score === 0) continue;
      const set = row.set
        ? scoreSetMatch(p.set, { code: row.set, name: row.set })
        : { score: 0.7, reason: "no set in the file" };
      // A wrong set with the right number and name is a different card (reprints), so it drags
      // the score down hard; a missing set only caps it below "sure".
      const score = row.set ? card.score * (0.4 + 0.6 * set.score) : card.score * 0.85;
      if (score < 0.3) continue;
      const picked = pickVariant(p.variants, row);
      if (!picked) continue;
      candidates.push({
        variantId: picked.variant.id,
        printingId: p.id,
        name: p.card.name,
        number: p.collectorNumber,
        setName: p.set.name,
        setCode: p.set.code,
        finish: picked.variant.finish,
        languageCode: picked.variant.languageCode,
        score: Math.round(score * 100) / 100,
        reason: [card.reason, row.set ? set.reason : set.reason, picked.note]
          .filter(Boolean)
          .join("; "),
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.setName.localeCompare(b.setName));
    const top = candidates[0];
    const status: ImportStatus = !top
      ? "none"
      : top.score >= SURE && (candidates[1]?.score ?? 0) < top.score - 0.04
        ? "matched"
        : "review";
    out.push({ row, status, candidates: candidates.slice(0, MAX_CANDIDATES) });
  }
  return out;
}

async function printingsNamed(name: string, game: string) {
  if (!name) return [];
  return prisma.printing.findMany({
    where: {
      card: { name: { contains: name } },
      set: { game: { slug: game }, category: { not: "pocket" } },
    },
    select: {
      id: true,
      collectorNumber: true,
      card: { select: { name: true } },
      set: { select: { code: true, name: true } },
      variants: { select: { id: true, finish: true, edition: true, languageCode: true } },
    },
    take: 400,
  });
}

export interface ImportItem {
  variantId: string;
  quantity: number;
  condition: string | null;
  /** Paid per card, EUR major units. */
  paid: number | null;
}

/** Adds the confirmed rows as new collection entries (one transaction); returns copies added. */
export async function commitImport(items: ImportItem[]): Promise<number> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    let copies = 0;
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) continue;
      await tx.printVariant.findUniqueOrThrow({ where: { id: item.variantId } });
      const paid = item.paid !== null && Number.isFinite(item.paid) && item.paid >= 0
        ? Math.round(item.paid * 100)
        : null;
      await tx.collectionItem.create({
        data: {
          variantId: item.variantId,
          quantity: item.quantity,
          condition: item.condition ?? "NEAR_MINT",
          purchasePrice: paid,
          purchaseCurrency: paid !== null ? "EUR" : null,
          acquiredAt: now,
        },
      });
      copies += item.quantity;
    }
    return copies;
  });
}

