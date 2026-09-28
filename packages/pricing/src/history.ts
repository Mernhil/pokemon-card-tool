// Pure, client-safe: imports only the Node-free parts of @tcg-vault/shared.
import { convertMinor, type FxRates } from "@tcg-vault/shared/src/currency";
import type { PriceKind } from "@tcg-vault/shared/src/enums";
import { conditionRank, headlineKind, type PricePoint } from "./observations";

export const HISTORY_RANGES = ["7d", "30d", "90d", "1y", "all"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

const DAY = 86_400_000;
const RANGE_MS: Record<HistoryRange, number> = {
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  "90d": 90 * DAY,
  "1y": 365 * DAY,
  all: Number.POSITIVE_INFINITY,
};

/** `v: null` breaks the line: the chart must not draw across a long data gap. */
export interface ChartPoint {
  t: number;
  v: number | null;
}

export interface ShapedSeries {
  provider: string;
  kind: PriceKind;
  /** Currency of `points` (the display currency when `converted`). */
  currency: string;
  /** True when the values were converted from another currency (approximate). */
  converted: boolean;
  points: ChartPoint[];
}

export interface ShapedHistory {
  series: ShapedSeries[];
  /** Providers left out because their currency has no exchange rate. */
  unconvertible: Array<{ provider: string; currency: string }>;
  /** Any value on the chart was converted between currencies. */
  approximate: boolean;
  /** Number of distinct days with data, across all series. */
  days: number;
}

/**
 * Price history -> chart series: one line per provider, using that
 * provider's headline kind throughout (a line never switches between, say,
 * trend and lowest listing), best condition only, one point per day (the
 * day's last observation), in the display currency.
 *
 * A gap longer than max(3 days, 3x the series' usual spacing) gets a break,
 * so a line never implies it knows prices for weeks it has no data for.
 */
export function shapeHistory(
  points: PricePoint[],
  options: {
    providers: string[];
    range: HistoryRange;
    now?: Date;
    displayCurrency: string;
    rates: FxRates;
  },
): ShapedHistory {
  const now = (options.now ?? new Date()).getTime();
  const since = now - RANGE_MS[options.range];
  const inRange = points.filter(
    (p) => p.observedAt.getTime() >= since && p.observedAt.getTime() <= now,
  );
  const series: ShapedSeries[] = [];
  const unconvertible: ShapedHistory["unconvertible"] = [];
  const allDays = new Set<number>();

  for (const provider of options.providers) {
    const kind = headlineKind(provider, inRange);
    if (!kind) continue;
    const own = inRange.filter((p) => p.provider === provider && p.kind === kind);
    // Same condition as the headline (near mint, else "not split by condition", ...).
    const bestRank = Math.min(...own.map((p) => conditionRank(p.condition)));
    const chosen = own.filter((p) => conditionRank(p.condition) === bestRank);

    // One point per UTC day: that day's latest observation.
    const perDay = new Map<number, PricePoint>();
    for (const p of chosen) {
      const day = Math.floor(p.observedAt.getTime() / DAY) * DAY;
      const prev = perDay.get(day);
      if (!prev || p.observedAt > prev.observedAt) perDay.set(day, p);
    }
    const days = [...perDay.entries()].sort((a, b) => a[0] - b[0]);
    if (days.length === 0) continue;

    let converted = false;
    let failedCurrency: string | null = null;
    const values: ChartPoint[] = [];
    for (const [day, p] of days) {
      const v = convertMinor(p.amount, p.currency, options.displayCurrency, options.rates);
      if (v === null) {
        failedCurrency = p.currency;
        break;
      }
      if (p.currency.toUpperCase() !== options.displayCurrency.toUpperCase()) converted = true;
      values.push({ t: day, v });
    }
    if (failedCurrency) {
      unconvertible.push({ provider, currency: failedCurrency });
      continue;
    }
    for (const [day] of days) allDays.add(day);
    series.push({
      provider,
      kind,
      currency: options.displayCurrency,
      converted,
      points: breakGaps(values),
    });
  }

  return {
    series,
    unconvertible,
    approximate: series.some((s) => s.converted),
    days: allDays.size,
  };
}

/** Inserts a `null` point inside every gap that's much longer than the series' usual spacing. */
export function breakGaps(points: ChartPoint[], minGapMs = 3 * DAY): ChartPoint[] {
  if (points.length < 2) return points;
  const intervals = points
    .slice(1)
    .map((p, i) => p.t - points[i]!.t)
    .sort((a, b) => a - b);
  const typical = intervals[Math.floor(intervals.length / 2)]!;
  const threshold = Math.max(minGapMs, typical * 3);
  const out: ChartPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur.t - prev.t > threshold)
      out.push({ t: prev.t + Math.round((cur.t - prev.t) / 2), v: null });
    out.push(cur);
  }
  return out;
}
