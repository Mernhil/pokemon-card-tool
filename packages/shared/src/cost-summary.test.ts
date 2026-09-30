import { describe, expect, it } from "vitest";
import { computeTotals, mostExpensive, type CostCard } from "./cost-summary";

const card = (id: string, ...variants: Array<[number | null, boolean?]>): CostCard => ({
  id,
  variants: variants.map(([value, owned]) => ({ value, owned: owned ?? false })),
});

// Jirachi-like search: a cheap common with two finishes, an owned holo, a pricey ultra, an unpriced promo.
const cards = [
  card("common", [50], [120]), // normal 0.50, reverse 1.20
  card("holo", [800, true]), // owned
  card("ultra", [4000], [9000]),
  card("promo", [null]),
];

describe("computeTotals", () => {
  it("cheapest finish: one copy of every priced card", () => {
    expect(computeTotals(cards, "cheapest")).toEqual({
      total: 50 + 800 + 4000,
      counted: 3,
      remaining: 50 + 4000, // the owned holo isn't "still to buy"
      remainingCount: 2,
      owned: 1,
      cards: 4,
      unpriced: 1, // the promo: not in any total, but counted in the note
    });
  });

  it("every finish: each finish counts, owned finishes drop out of 'still to buy'", () => {
    expect(computeTotals(cards, "every")).toEqual({
      total: 50 + 120 + 800 + 4000 + 9000,
      counted: 5,
      remaining: 50 + 120 + 4000 + 9000,
      remainingCount: 4,
      owned: 1,
      cards: 4,
      unpriced: 1,
    });
  });

  it("owning any finish counts as owning the card in cheapest mode", () => {
    const mixed = [card("x", [100], [300, true])];
    expect(computeTotals(mixed, "cheapest")).toMatchObject({ total: 100, remaining: 0, owned: 1 });
    // In every-finish mode only the owned finish drops out.
    expect(computeTotals(mixed, "every")).toMatchObject({ total: 400, remaining: 100, owned: 1 });
  });

  it("a card with a price in only some finishes still counts the priced ones", () => {
    const partly = [card("x", [null], [250])];
    expect(computeTotals(partly, "cheapest")).toMatchObject({ total: 250, counted: 1, unpriced: 0 });
    expect(computeTotals(partly, "every")).toMatchObject({ total: 250, counted: 1, unpriced: 1 });
  });

  it("excluded cards drop out of everything", () => {
    const t = computeTotals(cards, "cheapest", new Set(["ultra", "holo"]));
    expect(t).toEqual({
      total: 50,
      counted: 1,
      remaining: 50,
      remainingCount: 1,
      owned: 0,
      cards: 2,
      unpriced: 1,
    });
  });

  it("an empty selection is all zeros", () => {
    expect(computeTotals([], "cheapest")).toMatchObject({ total: 0, cards: 0, unpriced: 0 });
  });
});

describe("mostExpensive", () => {
  it("picks the n priciest cards for 'exclude the top N'", () => {
    expect(mostExpensive(cards, "cheapest", 2)).toEqual(["ultra", "holo"]);
    expect(mostExpensive(cards, "every", 1)).toEqual(["ultra"]);
    expect(mostExpensive(cards, "cheapest", 0)).toEqual([]);
    expect(mostExpensive(cards, "cheapest", 10)).toEqual(["ultra", "holo", "common"]); // never the unpriced
  });
});
