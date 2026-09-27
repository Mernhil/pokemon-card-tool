export interface RawObservation {
  source: "SALE" | "CARDMARKET_TREND" | "CARDTRADER_LOW" | string;
  value: number;
  observedAt: string;
}

const SOURCE_WEIGHT: Record<string, number> = {
  SALE: 3,
  CARDMARKET_TREND: 2,
  CARDTRADER_LOW: 1,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Weighted median of recent observations, with outliers beyond 3x MAD discarded. */
export function resolveAnchor(observations: RawObservation[]): number | null {
  if (observations.length === 0) return null;

  const values = observations.map((o) => o.value);
  const m = median(values);
  const mad = median(values.map((v) => Math.abs(v - m))) || 1;

  const filtered = observations.filter((o) => Math.abs(o.value - m) <= 3 * mad);
  if (filtered.length === 0) return m;

  const expanded = filtered.flatMap((o) => {
    const weight = SOURCE_WEIGHT[o.source] ?? 1;
    return Array(weight).fill(o.value);
  });

  return median(expanded);
}
