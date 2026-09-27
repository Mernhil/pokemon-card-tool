import { derivedValue, resolveAnchor, type RawObservation } from "@tcg-vault/pricing";
import { toEur, toUsd } from "@tcg-vault/shared";
import { prisma } from "./client";

/** Only prices this recent feed a valuation. */
const LOOKBACK_DAYS = 30;

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Pure: the single number we trust from one observation. Cardmarket's trend
 * is its smoothed "what it actually sells for"; TCGplayer's market price is
 * the same idea from recent sales. Fall back to mid, then low.
 */
export function observationValue(obs: {
  source: string;
  low: number | null;
  mid: number | null;
  market: number | null;
  trend: number | null;
}): { source: string; value: number } | null {
  const value =
    obs.source === "CARDMARKET"
      ? (obs.trend ?? obs.mid ?? obs.low)
      : (obs.market ?? obs.mid ?? obs.low ?? obs.trend);
  if (value === null || value === undefined) return null;
  const source =
    obs.source === "CARDMARKET"
      ? "CARDMARKET_TREND"
      : obs.source === "TCGPLAYER"
        ? "TCGPLAYER_MARKET"
        : obs.source;
  return { source, value };
}

/**
 * Near-mint value per variant from its latest observation per source (all
 * converted to EUR), resolved through @tcg-vault/pricing's resolveAnchor, and
 * stored as today's VariantValuation "NM" bucket. Returns rows written.
 */
export async function computeValuations(now = new Date()): Promise<number> {
  const day = utcDay(now);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  const observations = await prisma.priceObservation.findMany({
    where: { observedAt: { gte: since } },
    orderBy: { observedAt: "desc" },
  });

  // Latest observation per (variant, source).
  const latest = new Map<string, Map<string, (typeof observations)[number]>>();
  for (const obs of observations) {
    let perSource = latest.get(obs.variantId);
    if (!perSource) latest.set(obs.variantId, (perSource = new Map()));
    if (!perSource.has(obs.source)) perSource.set(obs.source, obs);
  }

  let written = 0;
  for (const [variantId, perSource] of latest) {
    const raw: RawObservation[] = [];
    for (const obs of perSource.values()) {
      const picked = observationValue(obs);
      if (!picked) continue;
      raw.push({
        source: picked.source,
        value: toEur(picked.value, obs.currency),
        observedAt: obs.observedAt.toISOString(),
      });
    }
    const anchor = resolveAnchor(raw);
    if (anchor === null) continue;

    const valueEur = Math.round(anchor);
    const data = {
      valueEur,
      valueUsd: toUsd(valueEur, "EUR"),
      // One source is a guess, two agreeing sources is as good as it gets here.
      confidence: Math.min(1, raw.length / 2),
    };
    await prisma.variantValuation.upsert({
      where: { variantId_day_bucket: { variantId, day, bucket: "NM" } },
      update: data,
      create: { variantId, day, bucket: "NM", ...data },
    });
    written++;
  }
  return written;
}

/** variantId -> latest NM valuation (EUR/USD minor units). */
export async function latestValuations(
  variantIds?: string[],
): Promise<Map<string, { valueEur: number; valueUsd: number; day: Date }>> {
  const rows = await prisma.variantValuation.findMany({
    where: { bucket: "NM", ...(variantIds ? { variantId: { in: variantIds } } : {}) },
    orderBy: { day: "desc" },
  });
  const map = new Map<string, { valueEur: number; valueUsd: number; day: Date }>();
  for (const row of rows) {
    if (!map.has(row.variantId)) {
      map.set(row.variantId, { valueEur: row.valueEur, valueUsd: row.valueUsd, day: row.day });
    }
  }
  return map;
}

/**
 * Value of one collection entry in EUR minor units: the variant's NM value
 * scaled by condition (graded copies are valued as NM until graded prices
 * exist), times quantity. null when the variant has no valuation yet.
 */
export function collectionItemValue(
  nmValueEur: number | undefined,
  item: { quantity: number; condition: string | null },
): number | null {
  if (nmValueEur === undefined) return null;
  return derivedValue(nmValueEur, item.condition ?? "NEAR_MINT") * item.quantity;
}

/** Writes/overwrites today's PortfolioSnapshot from the collection x latest valuations. */
export async function snapshotPortfolio(now = new Date()): Promise<void> {
  const items = await prisma.collectionItem.findMany({
    include: {
      variant: {
        include: {
          printing: { include: { set: { include: { game: true } }, rarity: true } },
        },
      },
    },
  });
  const values = await latestValuations(items.map((i) => i.variantId));

  let totalValue = 0;
  let costBasis = 0;
  let itemCount = 0;
  const byGame: Record<string, number> = {};
  const bySet: Record<string, number> = {};
  const byRarity: Record<string, number> = {};

  for (const item of items) {
    itemCount += item.quantity;
    // purchasePrice is per card.
    if (item.purchasePrice) {
      costBasis += toEur(item.purchasePrice, item.purchaseCurrency ?? "EUR") * item.quantity;
    }
    const value = collectionItemValue(values.get(item.variantId)?.valueEur, item) ?? 0;
    totalValue += value;
    const { printing } = item.variant;
    byGame[printing.set.game.name] = (byGame[printing.set.game.name] ?? 0) + value;
    bySet[printing.set.name] = (bySet[printing.set.name] ?? 0) + value;
    const rarity = printing.rarity?.name ?? "Unknown";
    byRarity[rarity] = (byRarity[rarity] ?? 0) + value;
  }

  const day = utcDay(now);
  const data = {
    currency: "EUR",
    totalValue,
    costBasis: costBasis || null,
    itemCount,
    breakdown: JSON.stringify({ byGame, bySet, byRarity }),
  };
  await prisma.portfolioSnapshot.upsert({ where: { day }, update: data, create: { day, ...data } });
}
