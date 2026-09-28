import { describe, expect, it } from "vitest";
import type { FxRates } from "@tcg-vault/shared/src/currency";
import { breakGaps, shapeHistory } from "./history";
import { topMovers } from "./movers";
import { headlinePrice, type PricePoint } from "./observations";

const DAY = 86_400_000;
const now = new Date("2026-09-28T12:00:00Z");
const rates: FxRates = { source: "ecb", asOf: "2026-09-25", perEur: { EUR: 1, USD: 1.25 } };

function pt(
  provider: string,
  daysAgo: number,
  amount: number,
  extra: Partial<PricePoint> = {},
): PricePoint {
  return {
    provider,
    kind: "trend",
    amount,
    currency: "EUR",
    condition: null,
    listingCount: null,
    observedAt: new Date(now.getTime() - daysAgo * DAY),
    ...extra,
  };
}

const shape = (points: PricePoint[], opts: Partial<Parameters<typeof shapeHistory>[1]> = {}) =>
  shapeHistory(points, {
    providers: ["cardmarket", "tcgplayer", "ebay"],
    range: "all",
    now,
    displayCurrency: "EUR",
    rates,
    ...opts,
  });

describe("headlinePrice", () => {
  it("prefers each provider's most meaningful kind, then near mint, then the latest", () => {
    const points = [
      pt("cardmarket", 1, 90, { kind: "lowest_listing" }),
      pt("cardmarket", 1, 110),
      pt("cardmarket", 0, 120),
      pt("cardtrader", 0, 70, { kind: "lowest_listing", condition: "LIGHTLY_PLAYED" }),
      pt("cardtrader", 0, 95, { kind: "lowest_listing", condition: "NEAR_MINT" }),
    ];
    expect(headlinePrice("cardmarket", points)).toMatchObject({ kind: "trend", amount: 120 });
    expect(headlinePrice("cardtrader", points)).toMatchObject({
      amount: 95,
      condition: "NEAR_MINT",
    });
    expect(headlinePrice("ebay", points)).toBeNull();
  });
});

describe("shapeHistory", () => {
  it("returns nothing (not a fake flat line) when there's no data", () => {
    expect(shape([])).toEqual({ series: [], unconvertible: [], approximate: false, days: 0 });
  });

  it("keeps a single observation as a single point", () => {
    const { series, days } = shape([pt("cardmarket", 2, 500)]);
    expect(days).toBe(1);
    expect(series).toHaveLength(1);
    expect(series[0]!.points).toEqual([{ t: expect.any(Number), v: 500 }]);
  });

  it("uses one point per day (that day's latest) and one kind per line", () => {
    const points = [
      pt("cardmarket", 3.2, 100),
      pt("cardmarket", 3.1, 105), // same day, later -> wins
      pt("cardmarket", 2, 110),
      pt("cardmarket", 2, 60, { kind: "lowest_listing" }), // other kind: not on the trend line
    ];
    const [line] = shape(points).series;
    expect(line!.kind).toBe("trend");
    expect(line!.points.map((p) => p.v)).toEqual([105, 110]);
  });

  it("breaks the line across a long gap instead of implying it knows those days", () => {
    const daily = [30, 29, 28, 27, 10, 9, 8].map((d, i) => pt("cardmarket", d, 100 + i));
    const [line] = shape(daily).series;
    const values = line!.points.map((p) => p.v);
    expect(values).toEqual([100, 101, 102, 103, null, 104, 105, 106]);
  });

  it("does not break a line whose normal cadence is just slow", () => {
    const weekly = [28, 21, 14, 7, 0].map((d, i) => pt("cardmarket", d, 100 + i));
    expect(shape(weekly).series[0]!.points.some((p) => p.v === null)).toBe(false);
  });

  it("converts other currencies to the display currency and flags it", () => {
    const history = shape([
      pt("cardmarket", 1, 1000),
      pt("tcgplayer", 1, 1250, { kind: "market_average", currency: "USD" }),
    ]);
    expect(history.approximate).toBe(true);
    const byProvider = Object.fromEntries(history.series.map((s) => [s.provider, s]));
    expect(byProvider.cardmarket).toMatchObject({ converted: false, currency: "EUR" });
    expect(byProvider.tcgplayer).toMatchObject({ converted: true, currency: "EUR" });
    expect(byProvider.tcgplayer!.points[0]!.v).toBe(1000);
  });

  it("leaves out (and reports) a provider whose currency has no rate, rather than guessing", () => {
    const history = shape([
      pt("cardmarket", 1, 1000),
      pt("ebay", 1, 1500, { kind: "asking", currency: "XYZ" }),
    ]);
    expect(history.series.map((s) => s.provider)).toEqual(["cardmarket"]);
    expect(history.unconvertible).toEqual([{ provider: "ebay", currency: "XYZ" }]);
  });

  it("filters by range", () => {
    const points = [
      pt("cardmarket", 200, 1),
      pt("cardmarket", 60, 2),
      pt("cardmarket", 20, 3),
      pt("cardmarket", 3, 4),
    ];
    const values = (range: "7d" | "30d" | "90d" | "1y") =>
      shape(points, { range })
        .series[0]?.points.filter((p) => p.v !== null)
        .map((p) => p.v) ?? [];
    expect(values("7d")).toEqual([4]);
    expect(values("30d")).toEqual([3, 4]);
    expect(values("90d")).toEqual([2, 3, 4]);
    expect(values("1y")).toEqual([1, 2, 3, 4]);
  });
});

describe("breakGaps", () => {
  it("leaves 0-1 points alone", () => {
    expect(breakGaps([])).toEqual([]);
    expect(breakGaps([{ t: 0, v: 1 }])).toEqual([{ t: 0, v: 1 }]);
  });
});

describe("topMovers", () => {
  const v = (id: string, daysAgo: number, value: number) => ({
    id,
    day: new Date(now.getTime() - daysAgo * DAY),
    value,
  });

  it("compares the latest value with the value at the start of the window, biggest change first", () => {
    const movers = topMovers(
      [
        v("a", 10, 100),
        v("a", 0, 150),
        v("b", 8, 1000),
        v("b", 0, 900),
        v("c", 9, 50),
        v("c", 0, 50),
      ],
      { now, days: 7 },
    );
    expect(movers.map((m) => [m.id, m.change])).toEqual([
      ["b", -100],
      ["a", 50],
    ]);
    expect(movers[1]!.pct).toBe(0.5);
  });

  it("needs a value from before the window (no invented baseline)", () => {
    expect(topMovers([v("new", 2, 100), v("new", 0, 300)], { now, days: 7 })).toEqual([]);
  });
});
