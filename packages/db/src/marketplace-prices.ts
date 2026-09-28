import type { FetchedPrice, PriceSourceAdapter, VariantRef } from "@tcg-vault/sources";
import { prisma } from "./client";

export interface MarketplaceSyncOptions {
  /** Cap how many variants to price in one run — a full catalog run against a rate-limited API is slow. */
  limit?: number;
  /** Only variants of this printing's game, e.g. "pokemon". Defaults to every game. */
  gameSlug?: string;
}

export interface MarketplaceSyncResult {
  variantsChecked: number;
  observationsWritten: number;
  mappingsCached: number;
}

/**
 * Drives one PriceSourceAdapter (CardTrader, eBay, ...) over every synced
 * PrintVariant, writing a PriceObservation per price it found and caching
 * any externalId the adapter resolved (see VariantRef.externalIds) into
 * MarketplaceMapping so the next run can skip re-resolving the same card.
 *
 * Entirely opt-in: nothing calls this unless a caller constructs an adapter
 * with real credentials (see .env.example CARDTRADER_API_TOKEN /
 * EBAY_CLIENT_ID+SECRET) and wires it in — e.g. apps/web/lib/scheduler.ts.
 */
export async function syncMarketplacePrices(
  adapter: PriceSourceAdapter,
  sourceKind: string,
  marketplace: string,
  options: MarketplaceSyncOptions = {},
): Promise<MarketplaceSyncResult> {
  const variants = await prisma.printVariant.findMany({
    where: options.gameSlug ? { printing: { set: { game: { slug: options.gameSlug } } } } : {},
    take: options.limit,
    include: {
      printing: { include: { card: true, set: true } },
      mappings: { where: { marketplace } },
    },
  });

  const refs: VariantRef[] = variants.map((v) => {
    const cached = v.mappings[0];
    const externalIds: Record<string, string> = {};
    if (cached) externalIds[`${marketplace.toLowerCase()}BlueprintId`] = cached.productId;
    return {
      variantId: v.id,
      externalIds,
      cardName: v.printing.card.name,
      setCode: v.printing.set.code,
      setName: v.printing.set.name,
      collectorNumber: v.printing.collectorNumber,
      finish: v.finish,
      languageCode: v.languageCode,
    };
  });

  const prices = await adapter.fetchPrices(refs);

  let observationsWritten = 0;
  for (const price of prices) {
    observationsWritten += await writeObservation(price, sourceKind);
  }

  return {
    variantsChecked: refs.length,
    observationsWritten,
    // Caching resolved ids back into MarketplaceMapping is left for a
    // follow-up: it needs the adapter to report back *which* externalId it
    // resolved per variant (FetchedPrice doesn't carry that today), so a
    // wrong guess doesn't get permanently cached under the wrong variant.
    mappingsCached: 0,
  };
}

async function writeObservation(price: FetchedPrice, sourceKind: string): Promise<number> {
  const observedAt = new Date(price.observedAt);
  if (Number.isNaN(observedAt.getTime())) return 0;

  const dupe = await prisma.priceObservation.findFirst({
    where: { variantId: price.variantId, source: sourceKind, observedAt },
    select: { id: true },
  });
  if (dupe) return 0;

  await prisma.priceObservation.create({
    data: {
      variantId: price.variantId,
      source: sourceKind,
      condition: price.condition ?? null,
      currency: price.currency,
      low: price.low ?? null,
      mid: price.mid ?? null,
      market: price.market ?? null,
      trend: price.trend ?? null,
      observedAt,
    },
  });
  return 1;
}
