import { convertMinor } from "@tcg-vault/shared";
import { prisma } from "./client";
import { loadFxRates } from "./fx";
import { latestValuations } from "./valuations";

/**
 * Which raw cards are worth sending for grading: the stored graded asking
 * prices (eBay, per company and grade) against the card's near-mint value,
 * minus the fee the user enters (grading + shipping + insurance, per card).
 * Asking prices are an upper bound for what a slab sells for, so a verdict
 * is a hint, not a promise.
 */

export type GradingVerdict = "send" | "gamble" | "skip" | "unknown";

export interface GradingInputs {
  /** Near-mint value of the raw card, EUR minor units. */
  rawEur: number;
  /** Graded median asking price at the top grade and the one below, EUR minor units; null = no data. */
  tenEur: number | null;
  nineEur: number | null;
  /** Per-card fee, EUR minor units. */
  feeEur: number;
}

export interface GradingResult {
  gain10: number | null;
  gain9: number | null;
  verdict: GradingVerdict;
}

/**
 * "send": pays off even if it only grades one step below the top.
 * "gamble": pays off only at the top grade. "skip": doesn't pay off.
 */
export function gradingVerdict({ rawEur, tenEur, nineEur, feeEur }: GradingInputs): GradingResult {
  const gain10 = tenEur === null ? null : tenEur - rawEur - feeEur;
  const gain9 = nineEur === null ? null : nineEur - rawEur - feeEur;
  if (gain10 === null && gain9 === null) return { gain10, gain9, verdict: "unknown" };
  if (gain9 !== null && gain9 > 0) return { gain10, gain9, verdict: "send" };
  if (gain10 !== null && gain10 > 0) return { gain10, gain9, verdict: "gamble" };
  return { gain10, gain9, verdict: "skip" };
}

export interface GradingCandidate extends GradingResult {
  variantId: string;
  name: string;
  setName: string;
  setCode: string;
  gameSlug: string;
  collectorNumber: string;
  finish: string;
  /** Ungraded copies owned. */
  copies: number;
  rawEur: number;
  tenEur: number | null;
  nineEur: number | null;
  /** Listings behind the top-grade number. */
  listings10: number;
}

const gradeNumber = (key: string) => (/^\d+(\.\d+)?$/.test(key) ? Number(key) : null);

export async function gradingCandidates(
  company: string,
  feeEur: number,
): Promise<GradingCandidate[]> {
  const items = await prisma.collectionItem.findMany({
    where: { gradingCompany: null, certNumber: null },
    select: {
      quantity: true,
      variantId: true,
      variant: {
        select: {
          finish: true,
          printing: {
            select: {
              collectorNumber: true,
              card: { select: { name: true } },
              set: { select: { code: true, name: true, game: { select: { slug: true } } } },
            },
          },
        },
      },
    },
  });
  if (items.length === 0) return [];
  const byVariant = new Map<string, { item: (typeof items)[number]; copies: number }>();
  for (const item of items) {
    const row = byVariant.get(item.variantId);
    if (row) row.copies += item.quantity;
    else byVariant.set(item.variantId, { item, copies: item.quantity });
  }
  const ids = [...byVariant.keys()];
  const [values, graded, rates] = await Promise.all([
    latestValuations(ids),
    prisma.gradedPrice.findMany({
      where: { variantId: { in: ids }, company, gradeKey: { in: ["10", "9", "9.5"] } },
    }),
    loadFxRates(),
  ]);

  const fee = Math.round(feeEur * 100);
  const out: GradingCandidate[] = [];
  for (const [variantId, { item, copies }] of byVariant) {
    const raw = values.get(variantId)?.valueEur;
    if (raw === undefined) continue;
    // Prefer the English-listing numbers when several price languages were fetched.
    const rows = graded
      .filter((g) => g.variantId === variantId)
      .sort((a, b) => Number(b.languageCode === "en") - Number(a.languageCode === "en"));
    const pick = (grade: number) => {
      const row = rows.find((g) => gradeNumber(g.gradeKey) === grade);
      if (!row) return null;
      const eur = convertMinor(row.median, row.currency, "EUR", rates);
      return eur === null ? null : { eur, listings: row.listingCount };
    };
    const ten = pick(10);
    const nine = pick(9);
    const p = item.variant.printing;
    out.push({
      variantId,
      name: p.card.name,
      setName: p.set.name,
      setCode: p.set.code,
      gameSlug: p.set.game.slug,
      collectorNumber: p.collectorNumber,
      finish: item.variant.finish,
      copies,
      rawEur: raw,
      tenEur: ten?.eur ?? null,
      nineEur: nine?.eur ?? null,
      listings10: ten?.listings ?? 0,
      ...gradingVerdict({ rawEur: raw, tenEur: ten?.eur ?? null, nineEur: nine?.eur ?? null, feeEur: fee }),
    });
  }
  const order: Record<GradingVerdict, number> = { send: 0, gamble: 1, skip: 2, unknown: 3 };
  return out.sort(
    (a, b) =>
      order[a.verdict] - order[b.verdict] || (b.gain10 ?? -Infinity) - (a.gain10 ?? -Infinity),
  );
}
