import type { Money } from "@tcg-vault/shared";

export interface SourceSet {
  code: string;
  name: string;
  series?: string;
  releaseDate?: string;
  printedTotal?: number;
  totalCards?: number;
  logoUrl?: string;
  symbolUrl?: string;
}

export interface SourcePrinting {
  externalCardId: string;
  cardName: string;
  cardType: string;
  subtypes: string[];
  collectorNumber: string;
  rarityName?: string;
  artistName?: string;
  /**
   * Candidate image URLs, best first (e.g. high-res webp, then png, then
   * low-res). The sync downloads the first that exists.
   */
  imageUrls?: string[];
  attributes: Record<string, unknown>;
  /**
   * Finishes (packages/shared/src/enums.ts `Finish`) this printing actually
   * exists in, e.g. ["NON_FOIL", "REVERSE_HOLO"]. Empty/absent means the
   * source didn't say — the sync then falls back to a single NON_FOIL variant.
   */
  finishes?: string[];
  /** Market prices the source bundles with the card, one quote per finish x source. */
  prices?: SourcePriceQuote[];
}

/** A price snapshot for one finish of a printing, from one source. Amounts in minor units. */
export interface SourcePriceQuote {
  finish: string; // Finish
  source: string; // PriceSourceKind, see packages/shared/src/enums.ts
  currency: string;
  low?: number;
  mid?: number;
  market?: number;
  trend?: number;
  /** When the source last refreshed this price (ISO string), if it says. */
  observedAt?: string;
}

export interface VariantRef {
  variantId: string;
  externalIds: Record<string, string>; // per-source product/blueprint id, if known
  cardName: string;
  setCode: string;
  /** The set's display name — some price sources (e.g. CardTrader) key by name, not our set code. */
  setName: string;
  collectorNumber: string;
  finish: string;
  languageCode: string;
}

export interface FetchedPrice {
  variantId: string;
  currency: string;
  low?: Money["amount"];
  mid?: Money["amount"];
  market?: Money["amount"];
  trend?: Money["amount"];
  condition?: string;
  observedAt: string;
}

/**
 * Catalog-side source: sets and printings (card metadata, art, rarities).
 * Implemented by e.g. TCGdex, YGOPRODeck, the OPTCG API.
 */
export interface CatalogSourceAdapter {
  readonly slug: string;
  listSets(): Promise<SourceSet[]>;
  listPrintings(setCode: string): Promise<SourcePrinting[]>;
}

/**
 * Price-side source: live/aggregate pricing and outbound marketplace links.
 * Implemented by e.g. Cardmarket files, CardTrader, eBay Browse.
 */
export interface PriceSourceAdapter {
  readonly slug: string;
  fetchPrices(variantRefs: VariantRef[]): Promise<FetchedPrice[]>;
  buildLink(variant: VariantRef, copy: { condition?: string; language?: string }): string;
}

/**
 * @deprecated Catalog and pricing concerns are now split into
 * {@link CatalogSourceAdapter} and {@link PriceSourceAdapter}. This
 * intersection type only exists so older code that implements/consumes the
 * combined shape keeps compiling — prefer the split interfaces for anything
 * new.
 */
export type SourceAdapter = CatalogSourceAdapter & PriceSourceAdapter;
