import type { Prisma, PriceObservation } from "@prisma/client";
import type { PricePoint } from "@tcg-vault/pricing";
import type { PriceKind } from "@tcg-vault/shared";
import {
  quoteToObservations,
  type ProviderObservation,
  type SourcePriceQuote,
} from "@tcg-vault/sources";
import { prisma } from "./client";

type Db = Prisma.TransactionClient;

/**
 * Appends a provider's observations for one variant. An observation the
 * provider dated itself (TCGdex's `updated`) that we already have is
 * skipped, so refreshing within the same source window adds no duplicates.
 * Returns the number written.
 */
export async function recordObservations(
  variantId: string,
  provider: string,
  observations: ProviderObservation[],
  db: Db = prisma,
): Promise<number> {
  let written = 0;
  for (const obs of observations) {
    const key = {
      variantId,
      provider,
      kind: obs.kind,
      condition: obs.condition,
      currency: obs.currency,
      observedAt: obs.observedAt,
    };
    const dupe = await db.priceObservation.findFirst({ where: key, select: { id: true } });
    if (dupe) continue;
    await db.priceObservation.create({
      data: {
        ...key,
        source: provider.toUpperCase(),
        amount: obs.amount,
        listingCount: obs.listingCount,
        payloadHash: obs.payloadHash,
      },
    });
    written++;
  }
  return written;
}

/**
 * Catalog sync's bundled prices (TCGdex -> Cardmarket/TCGplayer) for one
 * printing: each quote goes onto the variant with the same finish (UNLIMITED,
 * any language we synced) as typed observations, and the marketplace's own
 * product id becomes that variant's ProviderMapping (unless the user set one).
 * Quotes for a finish with no variant are ignored. Returns observations written.
 */
export async function recordPrices(
  printingId: string,
  quotes: SourcePriceQuote[],
  db: Db = prisma,
): Promise<number> {
  if (quotes.length === 0) return 0;

  const variants = await db.printVariant.findMany({
    where: { printingId, edition: "UNLIMITED" },
    select: { id: true, finish: true },
  });
  const byFinish = new Map(variants.map((v) => [v.finish, v.id]));

  let written = 0;
  for (const quote of quotes) {
    const variantId = byFinish.get(quote.finish);
    if (!variantId) continue;
    const provider = quote.source.toLowerCase();
    written += await recordObservations(variantId, provider, quoteToObservations(quote), db);

    const existing = await db.providerMapping.findUnique({
      where: { variantId_provider: { variantId, provider } },
    });
    if (!existing?.manualOverride) {
      const data = {
        externalId: quote.externalId ?? null,
        url:
          provider === "tcgplayer" && quote.externalId
            ? `https://www.tcgplayer.com/product/${quote.externalId}`
            : null,
        confidence: 1,
        status: "matched",
        notes: "Linked by TCGdex",
        resolvedAt: new Date(),
      };
      await db.providerMapping.upsert({
        where: { variantId_provider: { variantId, provider } },
        update: data,
        create: { variantId, provider, ...data },
      });
    }
  }
  return written;
}

/** Which kind each legacy (pre-pipeline) column held, per source. */
const LEGACY_KINDS: Record<
  string,
  Partial<Record<"low" | "mid" | "market" | "trend", PriceKind>>
> = {
  CARDMARKET: { trend: "trend", mid: "market_average", low: "lowest_listing" },
  TCGPLAYER: { market: "market_average", mid: "asking", low: "lowest_listing" },
};

/**
 * One stored row -> the price numbers it holds. New rows hold exactly one
 * (provider/kind/amount); rows written before the pricing pipeline hold up
 * to four (low/mid/market/trend) and are mapped by what those meant.
 */
export function normalizeObservation(row: PriceObservation): PricePoint[] {
  const provider = row.provider ?? row.source.toLowerCase();
  const base = {
    provider,
    currency: row.currency,
    condition: row.condition,
    listingCount: row.listingCount ?? row.sampleSize,
    observedAt: row.observedAt,
  };
  if (row.kind && row.amount !== null) {
    return [{ ...base, kind: row.kind as PriceKind, amount: row.amount }];
  }
  const kinds = LEGACY_KINDS[row.source] ?? {};
  const out: PricePoint[] = [];
  for (const field of ["trend", "market", "mid", "low"] as const) {
    const amount = row[field];
    const kind = kinds[field];
    if (amount !== null && kind) out.push({ ...base, kind, amount });
  }
  return out;
}

/** Every price point for these variants since `since` (all history when omitted), oldest first. */
export async function pricePoints(
  variantIds: string[],
  since?: Date,
): Promise<Map<string, PricePoint[]>> {
  const rows = await prisma.priceObservation.findMany({
    where: { variantId: { in: variantIds }, ...(since ? { observedAt: { gte: since } } : {}) },
    orderBy: { observedAt: "asc" },
  });
  const out = new Map<string, PricePoint[]>(variantIds.map((id) => [id, []]));
  for (const row of rows) out.get(row.variantId)!.push(...normalizeObservation(row));
  return out;
}
