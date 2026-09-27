/**
 * Runs daily after valuations refresh: writes one PortfolioSnapshot row
 * (total value + breakdown by game/set/rarity for the dashboard).
 */
export async function snapshotPortfolios(): Promise<void> {
  // TODO(sprint 5): sum CollectionItem quantity x VariantValuation.
}
