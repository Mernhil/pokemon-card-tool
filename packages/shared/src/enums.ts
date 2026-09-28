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
  /**
   * eBay *active* (asking) listing prices, not completed sales. eBay's
   * actual sold-price API (Marketplace Insights) is invite-only/restricted;
   * this is a best-effort stand-in via the open Browse API, and is
   * deliberately a separate kind from EBAY_SOLD so the two are never
   * confused or silently blended in an aggregate.
   */
  "EBAY_ACTIVE",
  "AGGREGATOR",
  "MANUAL",
] as const;
export type PriceSourceKind = (typeof PRICE_SOURCE_KINDS)[number];

/**
 * Languages the catalog can be synced/priced in (TCGdex's `SupportedLanguages`
 * covers more; this is the subset we surface — the main collector markets
 * plus the languages with their own exclusive sets, per the product ask).
 * `code` is also the TCGdex language code, so it's what feeds the adapter
 * directly (see packages/sources's TcgdexPokemonAdapter and
 * packages/db/src/catalog-sync.ts).
 */
export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "zh-tw", name: "Chinese (Traditional)" },
  { code: "zh-cn", name: "Chinese (Simplified)" },
] as const;
export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

/** The language a printing's shared display text (Card.name, Set.name, ...) is authored in. */
export const REFERENCE_LANGUAGE_CODE: SupportedLanguageCode = "en";

export const MARKETPLACES = ["CARDMARKET", "CARDTRADER", "EBAY", "TCGPLAYER"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];
