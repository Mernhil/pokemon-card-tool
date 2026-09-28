import type { SourcePriceQuote } from "@tcg-vault/sources";
import { prisma } from "./client";

/**
 * Appends one PriceObservation per quote onto the matching variant of a
 * printing (same finish + language, UNLIMITED). Quotes for a finish with no
 * variant are ignored. A quote whose source timestamp we've already stored
 * for that variant is skipped, so re-syncing within the same source refresh
 * window doesn't pile up duplicates.
 *
 * `languageCode` scopes which language's variant a quote attaches to — a
 * printing can have the same finish in several languages (see
 * catalog-sync.ts), and a source's prices are always for whichever language
 * we asked it about, so this must never fall back to "any language".
 *
 * Returns the number of observations written.
 */
export async function recordPrices(
  printingId: string,
  quotes: SourcePriceQuote[],
  languageCode: string,
): Promise<number> {
  if (quotes.length === 0) return 0;

  const variants = await prisma.printVariant.findMany({
    where: { printingId, edition: "UNLIMITED", languageCode },
    select: { id: true, finish: true },
  });
  const byFinish = new Map(variants.map((v) => [v.finish, v.id]));

  let written = 0;
  for (const quote of quotes) {
    const variantId = byFinish.get(quote.finish);
    if (!variantId) continue;

    const parsed = quote.observedAt ? new Date(quote.observedAt) : null;
    const observedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

    if (parsed) {
      const dupe = await prisma.priceObservation.findFirst({
        where: { variantId, source: quote.source, observedAt },
        select: { id: true },
      });
      if (dupe) continue;
    }

    await prisma.priceObservation.create({
      data: {
        variantId,
        source: quote.source,
        currency: quote.currency,
        low: quote.low ?? null,
        mid: quote.mid ?? null,
        market: quote.market ?? null,
        trend: quote.trend ?? null,
        observedAt,
      },
    });
    written++;
  }
  return written;
}
