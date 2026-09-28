/**
 * Value sets for every field that used to be a Prisma enum, back when the
 * database was Postgres. SQLite's Prisma connector has no enum support, so
 * these fields are now plain String columns (see packages/db/prisma/schema.prisma)
 * and this file is the single source of truth for valid values, used for
 * <select> options and zod validation.
 */

export const CONDITIONS = [
  "MINT",
  "NEAR_MINT",
  "LIGHTLY_PLAYED",
  "MODERATELY_PLAYED",
  "HEAVILY_PLAYED",
  "DAMAGED",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const FINISHES = [
  "NON_FOIL",
  "HOLO",
  "REVERSE_HOLO",
  "COSMOS_HOLO",
  "CRACKED_ICE",
  "FULL_ART_TEXTURED",
  "RAINBOW",
  "GOLD",
  "ETCHED",
  "PARALLEL",
  "SECRET_TEXTURED",
  "ULTIMATE",
  "GHOST",
  "STARLIGHT",
  "QUARTER_CENTURY",
  "PRISMATIC",
  "OTHER",
] as const;
export type Finish = (typeof FINISHES)[number];

export const EDITIONS = [
  "UNLIMITED",
  "FIRST_EDITION",
  "SHADOWLESS",
  "LIMITED",
  "PROMO",
  "STAFF",
  "PRERELEASE",
] as const;
export type Edition = (typeof EDITIONS)[number];

export const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "TAG", "ACE", "OTHER"] as const;
export type GradingCompany = (typeof GRADING_COMPANIES)[number];

export const SET_TYPES = [
  "MAIN",
  "EXPANSION",
  "SPECIAL",
  "STARTER_DECK",
  "PROMO",
  "TIN_OR_COLLECTION",
  "TOURNAMENT",
] as const;
export type SetType = (typeof SET_TYPES)[number];

export const PRICE_SOURCE_KINDS = [
  "CARDMARKET",
  "CARDTRADER",
  "TCGPLAYER",
  "EBAY_SOLD",
  "AGGREGATOR",
  "MANUAL",
] as const;
export type PriceSourceKind = (typeof PRICE_SOURCE_KINDS)[number];

export const MARKETPLACES = ["CARDMARKET", "CARDTRADER", "EBAY", "TCGPLAYER"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** SyncState.status — see packages/db/src/jobs/runner.ts. */
export const SYNC_STATUSES = ["pending", "syncing", "done", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/**
 * Price providers, one adapter each (packages/sources/src/pricing). The two
 * "via TCGdex" providers are the marketplace numbers TCGdex relays with each
 * card; Cardmarket's own API isn't open to new users.
 */
export const PRICE_PROVIDERS = ["cardmarket", "tcgplayer", "cardtrader", "ebay"] as const;
export type PriceProviderId = (typeof PRICE_PROVIDERS)[number];

/**
 * What a price number actually is. The UI labels every price with its kind
 * and never presents an asking price as a sale.
 * - sold: an actual completed sale (or an average of them, with its count)
 * - asking: what sellers ask right now (e.g. median of active listings)
 * - market_average: a marketplace's average of recent *sales*
 * - trend: a marketplace's smoothed trend price
 * - lowest_listing: the cheapest current listing
 */
export const PRICE_KINDS = ["sold", "asking", "market_average", "trend", "lowest_listing"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  sold: "Sold",
  asking: "Asking",
  market_average: "Market avg",
  trend: "Trend",
  lowest_listing: "Lowest listing",
};

/** ProviderMapping.status */
export const MAPPING_STATUSES = ["matched", "low_confidence", "not_found"] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];
/** Automatic matches below this are "low_confidence": shown with a warning, not trusted for values. */
export const MIN_TRUSTED_MATCH = 0.8;
