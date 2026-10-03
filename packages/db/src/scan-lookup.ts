import { normalizeNumber } from "@tcg-vault/sources";
import type { ScannedNumber } from "@tcg-vault/shared";
import { prisma } from "./client";

/**
 * Webcam scanning: the collector numbers read off a card -> the printings
 * they could be. The number must match (leading zeros and spacing ignored);
 * the set total after the slash, when read, narrows it to the right set.
 */

export interface ScanCandidate {
  printingId: string;
  name: string;
  number: string;
  setName: string;
  setCode: string;
  gameSlug: string;
  imageKey: string | null;
  /** 1 = number and set total agree, lower = number only. */
  score: number;
  variants: Array<{ id: string; finish: string; languageCode: string }>;
}

export const MAX_SCAN_CANDIDATES = 12;

export async function findScanCandidates(
  numbers: ScannedNumber[],
  game = "pokemon",
): Promise<ScanCandidate[]> {
  const out = new Map<string, ScanCandidate>();
  for (const read of numbers.slice(0, 4)) {
    const wanted = normalizeNumber(read.number);
    const digits = /\d+/.exec(read.number)?.[0]?.replace(/^0+(?=\d)/, "");
    if (!wanted || !digits) continue;
    const total = /^\d+$/.test(read.total ?? "") ? Number(read.total) : null;
    const printings = await prisma.printing.findMany({
      where: {
        collectorNumber: { contains: digits },
        set: { game: { slug: game }, category: { not: "pocket" } },
      },
      select: {
        id: true,
        collectorNumber: true,
        imageKey: true,
        card: { select: { name: true } },
        set: { select: { code: true, name: true, printedTotal: true } },
        variants: {
          where: { edition: "UNLIMITED" },
          select: { id: true, finish: true, languageCode: true },
        },
      },
      take: 400,
    });
    for (const p of printings) {
      if (normalizeNumber(p.collectorNumber) !== wanted || p.variants.length === 0) continue;
      const totalAgrees = total !== null && p.set.printedTotal === total;
      // A read total that disagrees means a different set's card with the same number.
      if (total !== null && !totalAgrees && p.set.printedTotal !== null) continue;
      const score = totalAgrees ? 1 : 0.6;
      const have = out.get(p.id);
      if (have && have.score >= score) continue;
      out.set(p.id, {
        printingId: p.id,
        name: p.card.name,
        number: p.collectorNumber,
        setName: p.set.name,
        setCode: p.set.code,
        gameSlug: game,
        imageKey: p.imageKey,
        score,
        variants: p.variants,
      });
    }
  }
  return [...out.values()]
    .sort((a, b) => b.score - a.score || a.setName.localeCompare(b.setName))
    .slice(0, MAX_SCAN_CANDIDATES);
}
