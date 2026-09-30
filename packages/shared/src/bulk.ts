/** Default per-copy value (EUR minor units) under which a card counts as bulk: €2. */
export const DEFAULT_BULK_THRESHOLD = 200;

export interface BulkCandidate {
  /** Value of the whole entry (quantity × per-copy), EUR minor; null = unpriced. */
  value: number | null;
  quantity: number;
}

/**
 * Pure: is this collection entry bulk? Judged per copy (three €1 copies are
 * bulk, one €5 copy is not). Unpriced entries never are, so they stay visible;
 * a threshold of 0 turns bulk off.
 */
export function isBulk(row: BulkCandidate, threshold: number): boolean {
  return (
    threshold > 0 && row.value !== null && row.quantity > 0 && row.value / row.quantity < threshold
  );
}

export function partitionBulk<T extends BulkCandidate>(
  rows: T[],
  threshold: number,
): { main: T[]; bulk: T[] } {
  const main: T[] = [];
  const bulk: T[] = [];
  for (const r of rows) (isBulk(r, threshold) ? bulk : main).push(r);
  return { main, bulk };
}
