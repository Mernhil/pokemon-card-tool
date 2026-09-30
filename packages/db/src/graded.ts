import type { GradedObservation, PricedCard } from "@tcg-vault/sources";
import { DEFAULT_PRICE_LANGUAGE } from "@tcg-vault/shared";
import { prisma } from "./client";
import { loadPricedCard } from "./price-refresh";

/** Anything that can look up graded prices (the eBay provider). */
export interface GradedPriceSource {
  fetchGradedPrices(card: PricedCard): Promise<GradedObservation[]>;
}

/** Graded numbers older than this are offered for a refresh. */
export const GRADED_STALE_MS = 24 * 3_600_000;

/**
 * Looks up a variant's graded prices and stores them, replacing the previous
 * set for that price language. Returns how many company x grade rows were
 * written. Throws what the source throws (bad credentials, rate limit).
 */
export async function refreshGradedPrices(
  source: GradedPriceSource,
  variantId: string,
  priceLanguage: string = DEFAULT_PRICE_LANGUAGE,
  now = new Date(),
): Promise<number> {
  const card = await loadPricedCard(variantId, priceLanguage);
  if (!card) throw new Error("This card no longer exists in the catalog.");
  const rows = await source.fetchGradedPrices(card);
  const languageCode = card.priceLanguage ?? card.languageCode;
  await prisma.$transaction([
    prisma.gradedPrice.deleteMany({ where: { variantId, languageCode } }),
    prisma.gradedPrice.createMany({
      data: rows.map((r) => ({
        variantId,
        company: r.company,
        gradeKey: r.gradeKey,
        currency: r.currency,
        median: r.median,
        low: r.low,
        listingCount: r.listingCount,
        languageCode,
        observedAt: now,
      })),
    }),
  ]);
  return rows.length;
}

export interface GradedPriceRow {
  company: string;
  gradeKey: string;
  currency: string;
  median: number;
  low: number;
  listingCount: number;
  observedAt: Date;
}

/** Stored graded prices for a variant in one price language (empty if never fetched). */
export async function loadGradedPrices(
  variantId: string,
  priceLanguage: string = DEFAULT_PRICE_LANGUAGE,
): Promise<GradedPriceRow[]> {
  return prisma.gradedPrice.findMany({
    where: { variantId, languageCode: priceLanguage },
    select: {
      company: true,
      gradeKey: true,
      currency: true,
      median: true,
      low: true,
      listingCount: true,
      observedAt: true,
    },
  });
}
