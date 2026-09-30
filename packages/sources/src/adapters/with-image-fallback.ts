import type { CatalogSourceAdapter, SourcePrinting } from "../types";
import type { ImageFallbackSource } from "./pokemontcg-image-fallback";

/** collectorNumber is "localId/total" or bare "localId" (see tcgdex.ts collectorNumberFor). */
function localIdFrom(collectorNumber: string): string {
  return collectorNumber.split("/")[0] ?? collectorNumber;
}

/**
 * Wraps a {@link CatalogSourceAdapter} so any printing it returns with no
 * image at all (not "TCGdex hasn't scanned it", a sibling reprint already
 * covers that — just no candidate URLs whatsoever) gets a second chance from
 * `fallback`, matched by set name/release date + card number. Everything
 * else (sets, prices, finishes) passes through unchanged.
 *
 * The wrapper *inherits* from the adapter (Object.create) rather than
 * spreading it: adapters are class instances, and `{ ...adapter }` copies only
 * own properties, silently dropping every prototype method (getSet,
 * listSetSummaries, ...) — which made sets fail with "e.getSet is not a function".
 */
export function withImageFallback(
  adapter: CatalogSourceAdapter,
  fallback: ImageFallbackSource,
): CatalogSourceAdapter {
  const wrapped: CatalogSourceAdapter = Object.create(adapter);
  wrapped.listPrintings = async function listPrintings(setCode: string): Promise<SourcePrinting[]> {
    const printings = await adapter.listPrintings(setCode);
    const missing = printings.some((p) => !p.imageUrls || p.imageUrls.length === 0);
    if (!missing) return printings;

    const set = await adapter.getSet(setCode);
    if (!set) return printings;

    return Promise.all(
      printings.map(async (printing): Promise<SourcePrinting> => {
        if (printing.imageUrls && printing.imageUrls.length > 0) return printing;
        try {
          const imageUrls = await fallback.imageUrlsFor({
            setName: set.name,
            releaseDate: set.releaseDate,
            localId: localIdFrom(printing.collectorNumber),
          });
          return imageUrls && imageUrls.length > 0 ? { ...printing, imageUrls } : printing;
        } catch {
          return printing; // fallback lookup failing never fails the sync
        }
      }),
    );
  };
  return wrapped;
}
