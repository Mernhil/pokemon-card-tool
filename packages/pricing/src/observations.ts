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
  observedAt: Date;
}

/**
 * Which number is a provider's "current price", in order of preference.
 * Sales-based aggregates first; asking prices only where that's all the
 * provider has — and the kind always travels with the number to the UI.
 */
export const HEADLINE_KINDS: Record<string, PriceKind[]> = {
  cardmarket: ["trend", "market_average", "lowest_listing"],
  tcgplayer: ["market_average", "lowest_listing", "asking"],
  cardtrader: ["lowest_listing"],
  ebay: ["sold", "asking", "lowest_listing"],
};

const DEFAULT_KINDS: PriceKind[] = ["sold", "market_average", "trend", "asking", "lowest_listing"];

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
