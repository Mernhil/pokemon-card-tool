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
/**
 * `unavailable` is terminal-ish: the source genuinely can't provide the item
 * (404, empty set, removed). Retried rarely, never counted as a failure.
 */
export const SYNC_STATUSES = ["pending", "syncing", "done", "failed", "unavailable"] as const;
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

/** Languages a price can be quoted for (Settings "Price language", the card page selector). */
export const PRICE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "it", label: "Italian" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-Hans", label: "Chinese (Simplified)" },
  { code: "zh-Hant", label: "Chinese (Traditional)" },
  { code: "id", label: "Indonesian" },
  { code: "th", label: "Thai" },
] as const;
export type PriceLanguage = (typeof PRICE_LANGUAGES)[number]["code"];
/**
 * Pokémon catalogs TCGdex serves besides English: its language id, ours, and the
 * prefix on their set codes (TCGdex reuses ids like "neo1" across languages).
 * Cardmarket gives one product (and one price) to every European print of a card;
 * the Asian languages have products of their own.
 */
export const TCGDEX_LANGUAGES = [
  { tcgdex: "ja", code: "ja", prefix: "ja-" },
  { tcgdex: "fr", code: "fr", prefix: "fr-" },
  { tcgdex: "de", code: "de", prefix: "de-" },
  { tcgdex: "it", code: "it", prefix: "it-" },
  { tcgdex: "es", code: "es", prefix: "es-" },
  { tcgdex: "pt", code: "pt", prefix: "pt-" },
  { tcgdex: "ko", code: "ko", prefix: "ko-" },
  { tcgdex: "zh-cn", code: "zh-Hans", prefix: "zh-cn-" },
  { tcgdex: "zh-tw", code: "zh-Hant", prefix: "zh-tw-" },
  { tcgdex: "id", code: "id", prefix: "id-" },
  { tcgdex: "th", code: "th", prefix: "th-" },
] as const;

/** Set codes of sets that don't come from the English TCGdex catalog (other languages, tcgcsv promos). */
export function isForeignCatalogSet(code: string): boolean {
  return /^(JP|EN)-/.test(code) || TCGDEX_LANGUAGES.some((l) => code.startsWith(l.prefix));
}

export const DEFAULT_PRICE_LANGUAGE: PriceLanguage = "en";

export function isPriceLanguage(value: unknown): value is PriceLanguage {
  return PRICE_LANGUAGES.some((l) => l.code === value);
}

export function priceLanguageLabel(code: string): string {
  return PRICE_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/**
 * A marketplace's own language value ("en", "jp", "zh-CN", "German", ...)
 * -> one of our codes, or null when it isn't a language we know.
 */
export function normalizeListingLanguage(raw: unknown): PriceLanguage | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase().replace(/_/g, "-");
  const table: Record<string, PriceLanguage> = {
    en: "en",
    english: "en",
    de: "de",
    german: "de",
    deutsch: "de",
    fr: "fr",
    french: "fr",
    it: "it",
    italian: "it",
    es: "es",
    spanish: "es",
    pt: "pt",
    "pt-br": "pt",
    portuguese: "pt",
    ja: "ja",
    jp: "ja",
    japanese: "ja",
    ko: "ko",
    kr: "ko",
    korean: "ko",
    "zh-cn": "zh-Hans",
    "zh-hans": "zh-Hans",
    zh: "zh-Hans",
    "zh-tw": "zh-Hant",
    "zh-hant": "zh-Hant",
  };
  return table[v] ?? null;
}
