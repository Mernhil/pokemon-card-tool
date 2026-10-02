/**
 * Cloudflare D1 allows at most 100 bound parameters per query, so a long
 * `in: [...]` list has to be split. (Harmless on SQLite, which is why every
 * call site uses it regardless of the database.)
 */
export const MAX_IN = 80;

/** Runs `fn` over `values` in slices of `size` and concatenates the results. */
export async function inChunks<T, R>(
  values: readonly T[],
  fn: (chunk: T[]) => Promise<R[]>,
  size = MAX_IN,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < values.length; i += size) out.push(...(await fn(values.slice(i, i + size))));
  return out;
}
