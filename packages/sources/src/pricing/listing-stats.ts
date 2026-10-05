/**
 * Pure: the "what a copy really costs" number from a sorted list of listing prices — the
 * average of the cheapest few. How many it averages depends on how deep the market is: up to
 * five with plenty of listings, two with only a handful, nothing with fewer than three (the
 * cheapest listing then stands alone).
 *
 * A price gap alone doesn't decide what is real; support does. Listings are grouped into
 * price levels (a new level starts where the price jumps more than 15%), and a level counts
 * as the market only when several listings sit in it (3, or 2 while there are fewer than 8).
 * The average starts at the first such level. So a lone listing far below the rest — or a
 * couple of them — is a random post and is skipped, while a deep, gradually rising market
 * (a card whose better copies run to the 80s) is followed upward as far as the average
 * needs, but never across a jump of more than 25% to a level of its own. At most two
 * listings (and never a third of them) are passed over to reach the first supported level.
 * null when fewer than two listings qualify.
 */
export function lowestAverage(sorted: number[]): { amount: number; count: number } | null {
  const n = sorted.length;
  if (n < 3) return null;

  const levels: number[][] = [[sorted[0]!]];
  for (let i = 1; i < n; i++) {
    if (sorted[i]! > sorted[i - 1]! * 1.15) levels.push([sorted[i]!]);
    else levels[levels.length - 1]!.push(sorted[i]!);
  }
  const support = n >= 8 ? 3 : 2;
  // Only a couple of cheap posts may be passed over, and never a third of the market: a
  // scattered market whose cheapest listings all stand alone must not be valued from a
  // cluster of dear (often absurd) asking prices further up — it gets no average at all.
  const below = (level: number[]) => sorted.indexOf(level[0]!);
  const skippable = (level: number[]) => below(level) <= 2 && below(level) * 3 <= n;
  const real = levels.filter((l) => l.length >= support && skippable(l));
  if (real.length === 0) return null;

  // A small level far below the next real one is a random cheap post, not the floor.
  let start = real[0]!;
  const next = real[1];
  if (start.length < 3 && next && start[0]! < 0.7 * next[0]!) start = next;

  const want = n >= 20 ? 5 : n >= 12 ? 4 : n >= 6 ? 3 : 2;
  const picked = [...start];
  for (const level of levels.slice(levels.indexOf(start) + 1)) {
    if (picked.length >= want) break;
    if (level.length < support || level[0]! > picked[picked.length - 1]! * 1.25) break;
    picked.push(...level);
  }
  const used = picked.slice(0, want);
  if (used.length < 2) return null;
  return {
    amount: Math.round(used.reduce((x, y) => x + y, 0) / used.length),
    count: used.length,
  };
}


