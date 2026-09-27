/**
 * Nightly per-game catalog sync: pull sets/printings from each game's source
 * adapter (packages/sources) and upsert into Game/Set/Card/Printing/ExternalRef.
 */
export async function syncCatalog(_gameSlug: string): Promise<void> {
  // TODO(sprint 2): wire up TCGdex / YGOPRODeck / OPTCG API adapters.
}
