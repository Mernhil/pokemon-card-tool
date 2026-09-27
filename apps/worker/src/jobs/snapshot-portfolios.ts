/**
 * Runs nightly after valuations refresh: writes one PortfolioSnapshot row
 * per user (total value + breakdown by game/set/rarity for the dashboard).
 */
export async function snapshotPortfolios(): Promise<void> {
  // TODO(sprint 5): sum CollectionItem quantity x VariantValuation per user.
}
