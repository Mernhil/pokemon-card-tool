import { describe, expect, it } from "vitest";
import { DEFAULT_BULK_THRESHOLD, isBulk, partitionBulk } from "./bulk";

describe("isBulk", () => {
  it("judges per copy, not per entry", () => {
    expect(isBulk({ value: 300, quantity: 3 }, DEFAULT_BULK_THRESHOLD)).toBe(true); // 3 x €1
    expect(isBulk({ value: 500, quantity: 1 }, DEFAULT_BULK_THRESHOLD)).toBe(false);
  });
  it("is strictly under the threshold", () => {
    expect(isBulk({ value: 200, quantity: 1 }, 200)).toBe(false);
    expect(isBulk({ value: 199, quantity: 1 }, 200)).toBe(true);
  });
  it("never hides unpriced cards, and 0 turns bulk off", () => {
    expect(isBulk({ value: null, quantity: 1 }, 200)).toBe(false);
    expect(isBulk({ value: 1, quantity: 1 }, 0)).toBe(false);
  });
});

describe("partitionBulk", () => {
  it("splits rows and keeps order", () => {
    const rows = [
      { id: "a", value: 50, quantity: 1 },
      { id: "b", value: 900, quantity: 1 },
      { id: "c", value: null, quantity: 1 },
      { id: "d", value: 120, quantity: 2 },
    ];
    const { main, bulk } = partitionBulk(rows, 200);
    expect(main.map((r) => r.id)).toEqual(["b", "c"]);
    expect(bulk.map((r) => r.id)).toEqual(["a", "d"]);
  });
});
