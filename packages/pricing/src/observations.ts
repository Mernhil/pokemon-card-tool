// Pure, client-safe: imports only the Node-free parts of @tcg-vault/shared.
import type { PriceKind } from "@tcg-vault/shared/src/enums";

/** One price number as stored (PriceObservation), in its native currency. */
export interface PricePoint {
  provider: string;
  kind: PriceKind;
  /** Minor units of `currency`. */
  amount: number;
  currency: string;
  condition: string | null;
  listingCount: number | null;
  /** Language the number is for; null = the source can't split by language (or didn't say). */
  languageCode?: string | null;
  observedAt: Date;
}

/**
 * Which number is a provider's "current price", in order of preference.
 * Sales-based aggregates first; asking prices only where that's all the
 * provider has — and the kind always travels with the number to the UI.
 */
export const HEADLINE_KINDS: Record<string, PriceKind[]> = {
  // Never "lowest_listing": Cardmarket's price guide spans every language, so its cheapest
  // listing is usually a German/Italian copy. It stays visible as a secondary number only.
  cardmarket: ["trend", "market_average"],
  tcgplayer: ["market_average", "lowest_listing", "asking"],
  cardtrader: ["lowest_listing"],
  // The cheapest listing leads (with its range and average alongside); the median asking
  // price stays in the details.
  ebay: ["sold", "lowest_listing", "asking"],
};

const DEFAULT_KINDS: PriceKind[] = ["sold", "market_average", "trend", "asking", "lowest_listing"];

/**
 * Markets that only sell English cards: TCGplayer is a US marketplace, so its prices belong to
 * the English card and say nothing about the same card in another language.
 */
export const ENGLISH_ONLY_PROVIDERS = new Set(["tcgplayer"]);

/** Providers whose listings carry a language, so they can be filtered to one. */
export const LANGUAGE_AWARE_PROVIDERS = new Set(["cardtrader", "ebay"]);

export type LanguageMode =
  /** Numbers that are for exactly the requested language. */
  | "language"
  /** The provider can't split by language: its numbers mix every language. */
  | "all-languages"
  /** Language-aware provider, but only numbers that didn't say which language. */
  | "unsplit"
  /** Language-aware provider with data, but none in the requested language. */
  | "other-languages"
  | "none";

/**
 * A provider's points for one language. Language-aware providers (CardTrader,
 * eBay) give the requested language's numbers; if they only have unlabelled
 * ones, those are used (mode "unsplit", lower trust); data in other languages
 * is never used. Providers that can't split (Cardmarket, TCGplayer) return
 * everything, labelled "all-languages" — never presented as a language.
 */
export function pointsForLanguage(
  provider: string,
  points: PricePoint[],
  language: string,
): { points: PricePoint[]; mode: LanguageMode } {
  const own = points.filter((p) => p.provider === provider);
  if (own.length === 0) return { points: [], mode: "none" };
  if (ENGLISH_ONLY_PROVIDERS.has(provider)) {
    return language === "en"
      ? { points: own, mode: "all-languages" }
      : { points: [], mode: "other-languages" };
  }
  if (!LANGUAGE_AWARE_PROVIDERS.has(provider)) return { points: own, mode: "all-languages" };
  const exact = own.filter((p) => p.languageCode === language);
  if (exact.length > 0) return { points: exact, mode: "language" };
  const unsplit = own.filter((p) => !p.languageCode);
  if (unsplit.length > 0) return { points: unsplit, mode: "unsplit" };
  return { points: [], mode: "other-languages" };
}

/** Condition preference for a headline: near mint (or "not split by condition") first. */
export const conditionRank = (condition: string | null) =>
  condition === "NEAR_MINT" ? 0 : condition === null ? 1 : condition === "MINT" ? 2 : 3;

/** The kind a provider's headline uses, given what it actually has. */
export function headlineKind(provider: string, points: PricePoint[]): PriceKind | null {
  const own = points.filter((p) => p.provider === provider);
  for (const kind of HEADLINE_KINDS[provider] ?? DEFAULT_KINDS) {
    if (own.some((p) => p.kind === kind)) return kind;
  }
  return null;
}

/**
 * The provider's current headline price: its preferred kind, best
 * condition, latest observation. null when it has nothing.
 */
export function headlinePrice(provider: string, points: PricePoint[]): PricePoint | null {
  const kind = headlineKind(provider, points);
  if (!kind) return null;
  const candidates = points.filter((p) => p.provider === provider && p.kind === kind);
  const bestRank = Math.min(...candidates.map((p) => conditionRank(p.condition)));
  return candidates
    .filter((p) => conditionRank(p.condition) === bestRank)
    .reduce((a, b) => (b.observedAt > a.observedAt ? b : a));
}

/** Everything the provider reported in its most recent refresh (same observedAt day). */
export function latestRefresh(provider: string, points: PricePoint[]): PricePoint[] {
  const own = points.filter((p) => p.provider === provider);
  if (own.length === 0) return [];
  const latest = Math.max(...own.map((p) => p.observedAt.getTime()));
  const dayStart = latest - 36 * 3_600_000;
  const recent = own.filter((p) => p.observedAt.getTime() >= dayStart);
  // Newest per (kind, condition, currency).
  const byKey = new Map<string, PricePoint>();
  for (const p of recent.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())) {
    const key = `${p.kind}|${p.condition}|${p.currency}`;
    if (!byKey.has(key)) byKey.set(key, p);
  }
  return [...byKey.values()];
}
