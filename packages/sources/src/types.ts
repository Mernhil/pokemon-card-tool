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
  imageUrl?: string;
  attributes: Record<string, unknown>;
}

export interface VariantRef {
  variantId: string;
  externalIds: Record<string, string>; // per-source product/blueprint id, if known
  cardName: string;
  setCode: string;
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
 * One implementation per external source (TCGdex, YGOPRODeck, OPTCG API,
 * Cardmarket files, CardTrader, eBay Browse...). The worker only ever talks
 * to this interface, so swapping a source touches one file.
 */
export interface SourceAdapter {
  readonly slug: string;
  listSets(): Promise<SourceSet[]>;
  listPrintings(setCode: string): Promise<SourcePrinting[]>;
  fetchPrices(variantRefs: VariantRef[]): Promise<FetchedPrice[]>;
  buildLink(variant: VariantRef, copy: { condition?: string; language?: string }): string;
}
