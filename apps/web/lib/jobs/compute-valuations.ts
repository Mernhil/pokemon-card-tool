/**
 * Resolves an anchor NM price per variant (packages/pricing), applies the
 * condition curve for derived buckets, and writes VariantValuation rows for
 * every bucket that any user actually owns, plus NM for all variants.
 */
export async function computeValuations(): Promise<void> {
  // TODO(sprint 4): implement using @tcg-vault/pricing resolveAnchor + derivedValue.
}
