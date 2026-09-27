/**
 * Scheduled per source: pulls raw observations via a SourceAdapter and writes
 * them into PriceObservation / SaleRecord (append-only).
 */
export async function syncPrices(_sourceSlug: string): Promise<void> {
  // TODO(sprint 4): Cardmarket price-guide files, CardTrader API, eBay Browse.
}
