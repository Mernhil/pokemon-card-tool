import { evaluateAlerts } from "./alerts";
import {
  derivedValue,
  headlinePrice,
  pointsForLanguage,
  resolveAnchor,
  type PricePoint,
  type RawObservation,
} from "@tcg-vault/pricing";
import { DEFAULT_PRICE_LANGUAGE, convertMinor, type FxRates } from "@tcg-vault/shared";
import { prisma } from "./client";
import { loadFxRates } from "./fx";
import { normalizeObservation } from "./prices";
import { getSettings } from "./settings";

/** Only prices this recent feed a valuation. */
const LOOKBACK_DAYS = 30;

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * How much each provider's headline counts in the near-mint value
 * (packages/pricing resolveAnchor weights): sales-based aggregates count
 * double, listings single.
 */
function anchorSource(p: PricePoint): string {
  if (p.kind === "sold") return "SALE";
  if (p.provider === "cardmarket" && (p.kind === "trend" || p.kind === "market_average"))
    return "CARDMARKET_TREND";
  if (p.provider === "tcgplayer" && p.kind === "market_average") return "TCGPLAYER_MARKET";
  if (p.provider === "cardtrader") return "CARDTRADER_LOW";
  return `${p.provider.toUpperCase()}_${p.kind.toUpperCase()}`;
}

/**
 * Pure: a variant's near-mint value in EUR minor units from its recent price
 * points — each provider's headline (near mint / unsplit only), converted to
 * EUR, combined by resolveAnchor. Providers in `untrusted` (low-confidence
 * matches) are left out. null when nothing usable is left.
 *
 * Language: a provider that can split by language (CardTrader, eBay) counts
 * with its `language` numbers; if it only has unlabelled ones those are used,
 * and numbers in other languages are never used (a cheap German copy must not
 * drag an English value down). Cardmarket/TCGplayer can't split: their
 * numbers count as they are. `mixedOnly` is true when no source was language-
 * specific, which lowers the confidence. Cardmarket's "lowest listing" (often
 * a German/Italian copy) is never an input.
 */
export function valueFromPoints(
  points: PricePoint[],
  rates: FxRates,
  untrusted: Set<string> = new Set(),
  language: string = DEFAULT_PRICE_LANGUAGE,
): { valueEur: number; sources: number; mixedOnly: boolean; providers: string[] } | null {
  const raw: RawObservation[] = [];
  const rawProviders: string[] = [];
  const listingProviders: string[] = [];
  // Listings in the card's own language (CardTrader, eBay) say what a copy costs now: they
  // decide the value when there are any. Cardmarket's trend mixes every language and is
  // pulled up by a few dear sales, so it only stands in when no such listing exists.
  const listingRaw: RawObservation[] = [];
  let languageSpecific = 0;
  for (const provider of new Set(points.map((p) => p.provider))) {
    if (untrusted.has(provider)) continue;
    const scoped = pointsForLanguage(provider, points, language);
    if (scoped.points.length === 0) continue;
    const usable = scoped.points.filter(
      (p) =>
        (p.condition === null || p.condition === "NEAR_MINT") &&
        !(p.provider === "cardmarket" && p.kind === "lowest_listing"),
    );
    const headline = headlinePrice(provider, usable);
    if (!headline) continue;
    if (scoped.mode === "language") languageSpecific++;
    const eur = convertMinor(headline.amount, headline.currency, "EUR", rates);
    if (eur === null) continue;
    const obs = {
      source: anchorSource(headline),
      value: eur,
      observedAt: headline.observedAt.toISOString(),
    };
    raw.push(obs);
    rawProviders.push(provider);
    // Unlabelled listings (CardTrader often doesn't name the language) are still live listings:
    // they beat Cardmarket's all-language trend, which would otherwise outweigh them.
    if (
      (scoped.mode === "language" || scoped.mode === "unsplit") &&
      headline.kind === "lowest_listing"
    ) {
      // The value is the average of the cheapest near-mint listings (one wrongly cheap listing
      // can't drag it down); with too few listings to average, the cheapest one stands alone.
      const avg = usable
        .filter((p) => p.kind === "lowest_avg" && p.observedAt.getTime() === headline.observedAt.getTime())
        .find((p) => p.condition === headline.condition && p.currency === headline.currency);
      const avgEur = avg ? convertMinor(avg.amount, avg.currency, "EUR", rates) : null;
      listingRaw.push(avgEur === null ? obs : { ...obs, value: avgEur });
      listingProviders.push(provider);
    }
  }
  const used = listingRaw.length > 0 ? listingRaw : raw;
  const anchor = resolveAnchor(used);
  return anchor === null
    ? null
    : {
        valueEur: Math.round(anchor),
        sources: raw.length,
        mixedOnly: languageSpecific === 0,
        // Which providers the value came from: the listing ones when there are any.
        providers: listingRaw.length > 0 ? listingProviders : rawProviders,
      };
}

/**
 * Near-mint value per variant from its recent observations, stored as
 * today's VariantValuation "NM" bucket (EUR and USD at today's rates).
 * With `variantIds`, only those variants are revalued (a page about to show
 * them, so a value never lags behind the prices next to it). Returns rows written.
 */
export async function computeValuations(
  now = new Date(),
  language?: string,
  { variantIds }: { variantIds?: string[] } = {},
): Promise<number> {
  if (variantIds && variantIds.length === 0) return 0;
  if (variantIds && variantIds.length > 500) {
    let written = 0;
    for (let i = 0; i < variantIds.length; i += 500)
      written += await computeValuations(now, language, { variantIds: variantIds.slice(i, i + 500) });
    return written;
  }
  const priceLanguage = language ?? (await getSettings()).priceLanguage;
  const day = utcDay(now);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const rates = await loadFxRates();
  const scope = variantIds ? { variantId: { in: variantIds } } : {};

  const [rows, lowConfidence] = await Promise.all([
    prisma.priceObservation.findMany({ where: { observedAt: { gte: since }, ...scope } }),
    prisma.providerMapping.findMany({
      where: { status: { not: "matched" }, ...scope },
      select: { variantId: true, provider: true },
    }),
  ]);
  const untrusted = new Map<string, Set<string>>();
  for (const m of lowConfidence) {
    if (!untrusted.has(m.variantId)) untrusted.set(m.variantId, new Set());
    untrusted.get(m.variantId)!.add(m.provider);
  }
  const byVariant = new Map<string, PricePoint[]>();
  for (const row of rows) {
    if (!byVariant.has(row.variantId)) byVariant.set(row.variantId, []);
    byVariant.get(row.variantId)!.push(...normalizeObservation(row));
  }

  // Today's rows from an earlier run (maybe in another price language): any variant that no
  // longer has a usable value in this language must not keep the old number.
  const todayRows = await prisma.variantValuation.findMany({
    where: { day, bucket: "NM", ...scope },
    select: { variantId: true, valueEur: true, valueUsd: true, confidence: true },
  });
  const existingToday = new Set(todayRows.map((r) => r.variantId));
  const sameAsStored = new Map(todayRows.map((r) => [r.variantId, r]));
  // A card is valued in its own language (an Italian card from Italian listings); an English
  // one follows the price language setting. An explicit `language` argument overrides both.
  const ownLanguage = new Map<string, string>();
  const ids = [...byVariant.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = await prisma.printVariant.findMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      select: { id: true, languageCode: true },
    });
    for (const v of chunk) if (v.languageCode !== "en") ownLanguage.set(v.id, v.languageCode);
  }
  let written = 0;
  for (const [variantId, points] of byVariant) {
    const value = valueFromPoints(
      points,
      rates,
      untrusted.get(variantId),
      language ?? ownLanguage.get(variantId) ?? priceLanguage,
    );
    if (!value) continue;
    const data = {
      valueEur: value.valueEur,
      valueUsd: convertMinor(value.valueEur, "EUR", "USD", rates) ?? value.valueEur,
      // One source is a guess, two agreeing sources is as good as it gets here; numbers
      // that mix languages (nothing language-specific) are trusted less still.
      confidence: Math.min(1, value.sources / 2) * (value.mixedOnly ? 0.6 : 1),
    };
    existingToday.delete(variantId);
    const stored = sameAsStored.get(variantId);
    if (
      stored &&
      stored.valueEur === data.valueEur &&
      stored.valueUsd === data.valueUsd &&
      stored.confidence === data.confidence
    )
      continue;
    await prisma.variantValuation.upsert({
      where: { variantId_day_bucket: { variantId, day, bucket: "NM" } },
      update: data,
      create: { variantId, day, bucket: "NM", ...data },
    });
    written++;
  }
  const stale = [...existingToday];
  for (let i = 0; i < stale.length; i += 500) {
    await prisma.variantValuation.deleteMany({
      where: { day, bucket: "NM", variantId: { in: stale.slice(i, i + 500) } },
    });
  }
  // Fresh values may have crossed someone's price alert (the full run checks them).
  if (!variantIds) await evaluateAlerts(now).catch(() => 0);
  return written;
}

type LatestValue = { valueEur: number; valueUsd: number; day: Date };

/** Valuations are written daily, so the latest one is almost always in this window. */
const RECENT_WINDOW_DAYS = 7;

async function readLatest(
  variantIds: string[] | undefined,
  since: Date | null,
  into: Map<string, LatestValue>,
): Promise<void> {
  const rows = await prisma.variantValuation.findMany({
    where: {
      bucket: "NM",
      ...(variantIds ? { variantId: { in: variantIds } } : {}),
      ...(since ? { day: { gte: since } } : {}),
    },
    orderBy: { day: "desc" },
    select: { variantId: true, valueEur: true, valueUsd: true, day: true },
  });
  for (const row of rows) {
    if (!into.has(row.variantId)) {
      into.set(row.variantId, { valueEur: row.valueEur, valueUsd: row.valueUsd, day: row.day });
    }
  }
}

/**
 * variantId -> latest NM valuation (EUR/USD minor units).
 *
 * Reads only the last week of history first instead of every day ever stored
 * (which grows without bound and made wide searches slow), then looks further
 * back just for the variants that had nothing recent.
 */
export async function latestValuations(variantIds?: string[]): Promise<Map<string, LatestValue>> {
  const map = new Map<string, LatestValue>();
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000);
  await readLatest(variantIds, since, map);
  if (variantIds) {
    const missing = variantIds.filter((id) => !map.has(id));
    if (missing.length > 0) await readLatest(missing, null, map);
  } else {
    // No id list: stale variants need the full history to be found at all.
    await readLatest(undefined, null, map);
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
  const rates = await loadFxRates();
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
      const eur =
        convertMinor(item.purchasePrice, item.purchaseCurrency ?? "EUR", "EUR", rates) ??
        item.purchasePrice;
      costBasis += eur * item.quantity;
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
