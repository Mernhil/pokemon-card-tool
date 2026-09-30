/**
 * The "what would it cost to buy all of these" maths behind the search page's
 * summary panel. Pure and client-safe: the server computes the baseline for
 * every filtered result, and the browser recomputes it instantly when the
 * user unticks cards (same function, same numbers).
 */

export interface CostVariant {
  /** Near-mint value in the price language, EUR minor units; null = no price yet. */
  value: number | null;
  owned: boolean;
}

export interface CostCard {
  id: string;
  variants: CostVariant[];
}

/** "cheapest": one copy of each card in its cheapest priced finish. "every": every finish. */
export type CostMode = "cheapest" | "every";

export interface CostTotals {
  /** Buy one of each: the cost of every counted card (owned or not). */
  total: number;
  /** Cards (or finishes, in "every" mode) that are in the total. */
  counted: number;
  /** Still to buy: the same, only for what isn't owned. */
  remaining: number;
  remainingCount: number;
  /** Cards you own at least one copy of / cards in the selection. */
  owned: number;
  cards: number;
  /** Cards (or finishes) without a price: not in any total. */
  unpriced: number;
}

/** What one card contributes to the totals. */
export interface CardCost {
  /** Priced entries: value + whether owned. */
  items: Array<{ value: number; owned: boolean }>;
  unpriced: number;
  owned: boolean;
}

export function cardCost(card: CostCard, mode: CostMode): CardCost {
  const owned = card.variants.some((v) => v.owned);
  const priced = card.variants.filter((v): v is CostVariant & { value: number } => v.value !== null);
  if (mode === "every") {
    return {
      items: priced.map((v) => ({ value: v.value, owned: v.owned })),
      unpriced: card.variants.length - priced.length,
      owned,
    };
  }
  if (priced.length === 0) return { items: [], unpriced: 1, owned };
  // The cheapest finish decides what "one copy" costs; owning any finish counts as owning the card.
  const cheapest = priced.reduce((a, b) => (b.value < a.value ? b : a));
  return { items: [{ value: cheapest.value, owned }], unpriced: 0, owned };
}

export function computeTotals(
  cards: CostCard[],
  mode: CostMode,
  excluded: ReadonlySet<string> = new Set(),
): CostTotals {
  const t: CostTotals = {
    total: 0,
    counted: 0,
    remaining: 0,
    remainingCount: 0,
    owned: 0,
    cards: 0,
    unpriced: 0,
  };
  for (const card of cards) {
    if (excluded.has(card.id)) continue;
    const c = cardCost(card, mode);
    t.cards++;
    if (c.owned) t.owned++;
    t.unpriced += c.unpriced;
    for (const item of c.items) {
      t.total += item.value;
      t.counted++;
      if (!item.owned) {
        t.remaining += item.value;
        t.remainingCount++;
      }
    }
  }
  return t;
}

/** Ids of the `n` cards that cost the most (by their cost in `mode`), for "exclude the top N". */
export function mostExpensive(cards: CostCard[], mode: CostMode, n: number): string[] {
  return cards
    .map((card) => ({
      id: card.id,
      cost: cardCost(card, mode).items.reduce((s, i) => s + i.value, 0),
    }))
    .filter((c) => c.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, Math.max(0, n))
    .map((c) => c.id);
}
