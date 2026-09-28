/** One day's value of one thing (e.g. a variant's near-mint valuation), minor units. */
export interface ValuePoint {
  id: string;
  day: Date;
  value: number;
}

export interface Mover {
  id: string;
  from: number;
  to: number;
  change: number;
  /** Relative change, e.g. 0.25 for +25%. */
  pct: number;
}

/**
 * Biggest value changes over the last `days`: each id's latest value vs its
 * value on the last day at or before the window start (so a card needs data
 * from before the window to count — no invented baselines). Sorted by
 * absolute change, largest first.
 */
export function topMovers(
  points: ValuePoint[],
  { days = 7, now = new Date(), limit = 5 } = {},
): Mover[] {
  const start = now.getTime() - days * 86_400_000;
  const byId = new Map<string, ValuePoint[]>();
  for (const p of points) {
    if (!byId.has(p.id)) byId.set(p.id, []);
    byId.get(p.id)!.push(p);
  }
  const movers: Mover[] = [];
  for (const [id, list] of byId) {
    const sorted = [...list].sort((a, b) => a.day.getTime() - b.day.getTime());
    const base = sorted.filter((p) => p.day.getTime() <= start).at(-1);
    const latest = sorted.at(-1);
    if (!base || !latest || latest === base || base.value <= 0) continue;
    const change = latest.value - base.value;
    if (change === 0) continue;
    movers.push({ id, from: base.value, to: latest.value, change, pct: change / base.value });
  }
  return movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, limit);
}
