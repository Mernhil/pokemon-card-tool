// Shared shape every data-source adapter implements (TCGdex, YGOPRODeck,
// OPTCG API, Cardmarket price-guide files, CardTrader, eBay Browse). Real
// implementations, and the exact set/printing/price payload shapes, land
// when catalog sync is built - this just fixes the interface so apps/worker
// can depend on it now.

export interface SourceSet {
  externalId: string;
  code: string;
  name: string;
  releaseDate?: string;
}

export interface SourcePrinting {
  externalId: string;
  setExternalId: string;
  collectorNumber: string;
  cardName: string;
}

export interface VariantRef {
  variantId: string;
  marketplaceProductId: string;
}

export interface PriceQuote {
  variantId: string;
  currency: string;
  low?: number;
  mid?: number;
  market?: number;
  observedAt: string;
}

export interface SourceAdapter {
  /** Stable identifier, e.g. "tcgdex", "ygoprodeck", "optcg". */
  readonly id: string;

  listSets(): Promise<SourceSet[]>;
  listPrintings(setCode: string): Promise<SourcePrinting[]>;
  fetchPrices(variantRefs: VariantRef[]): Promise<PriceQuote[]>;
  buildLink(marketplaceProductId: string): string;
}
