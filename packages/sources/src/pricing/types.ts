import type { MappingStatus, PriceKind, PriceProviderId } from "@tcg-vault/shared";

/** Everything a provider may need to find and price one of our variants. */
export interface PricedCard {
  variantId: string;
  /** Game.slug */
  game: string;
  cardName: string;
  setCode: string;
  setName: string;
  /** As printed: "001/064", "TG01/TG30", "SVP 123". */
  collectorNumber: string;
  printedTotal?: number | null;
  /** This variant's Finish (packages/shared/src/enums.ts). */
  finish: string;
  /** Edition of this variant (UNLIMITED for an ordinary print). */
  edition?: string;
  /**
   * The language to price (PRICE_LANGUAGES code) for providers that can look
   * one language up (eBay). Defaults to the variant's own languageCode.
   */
  priceLanguage?: string;
  /** Every finish this printing exists in (some sources price per printing, not per finish). */
  printingFinishes: string[];
  languageCode: string;
  /** Ids other sources already gave us, keyed by source: { "tcgdex-pokemon": "sv06.5-001", cardmarket: "712345" }. */
  externalIds: Record<string, string>;
}

/** How a provider identifies one of our variants. Stored as a ProviderMapping row. */
export interface ResolvedMapping {
  externalId: string | null;
  query: string | null;
  url: string | null;
  /** 0..1. Below MIN_TRUSTED_MATCH (0.8) the match is shown with a warning and not trusted for values. */
  confidence: number;
  status: MappingStatus;
  /** Human-readable reason: "Matched by set name + number + card name". */
  notes: string | null;
}

/** One price number, exactly as the provider means it. Amount in minor units of `currency`. */
export interface ProviderObservation {
  kind: PriceKind;
  amount: number;
  currency: string;
  condition: string | null;
  listingCount: number | null;
  /**
   * Language this number is for, or null/absent when the source can't split
   * by language (Cardmarket / TCGplayer price guides) or the listing didn't say.
   */
  languageCode?: string | null;
  observedAt: Date;
  /** Hash of the response it came from, for debugging odd numbers. */
  payloadHash: string | null;
}

export interface ProviderCapabilities {
  /** Can report actual sold prices (not just listings/aggregates). */
  supportsSold: boolean;
  /** The provider itself keeps price history we could read (we build our own either way). */
  supportsHistory: boolean;
  /** Kinds of numbers it produces. */
  kinds: PriceKind[];
  /** The documented (or our self-imposed) request budget. */
  rateLimit: { requests: number; perMs: number; note: string };
  needsCredentials: boolean;
  /** Game slugs it can price. */
  games: string[];
}

/**
 * One price source. Implementations: CardTrader (API token), eBay Browse
 * (OAuth app token), Cardmarket and TCGplayer via TCGdex (no key needed).
 * The background refresh (packages/db/src/price-refresh.ts) only talks to
 * this interface.
 */
export interface PriceProvider {
  readonly id: PriceProviderId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  /** Whether the credentials it needs are present (not whether they work). */
  isConfigured(): boolean;
  /** Finds the provider's id/query for a card. null when it can't even try (e.g. not configured). */
  resolveMapping(card: PricedCard): Promise<ResolvedMapping | null>;
  fetchPrices(card: PricedCard, mapping: ResolvedMapping): Promise<ProviderObservation[]>;
  /** A cheap authenticated request, for Settings' "Test connection". */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
