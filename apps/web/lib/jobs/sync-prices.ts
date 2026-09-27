import { syncCatalogSets, syncedSetCodes } from "@tcg-vault/db";

/**
 * Re-syncs every set already in the local catalog from TCGdex. TCGdex bundles
 * Cardmarket + TCGplayer prices with each card, so this is how prices get
 * refreshed; it also recomputes valuations and today's portfolio snapshot.
 * Images already on disk aren't re-downloaded.
 */
export async function syncPrices(): Promise<void> {
  const codes = await syncedSetCodes();
  if (codes.length === 0) return;
  const result = await syncCatalogSets(codes, {
    log: (line) => console.log(`[sync-prices] ${line}`),
  });
  console.log(
    `[sync-prices] ${result.setsProcessed} sets, ${result.priceObservations} new prices, ${result.errors.length} errors`,
  );
}
