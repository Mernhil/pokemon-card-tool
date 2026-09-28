/**
 * Exponential backoff with "full jitter": a random wait in
 * [0, min(max, base * 2^(attempt-1))]. Jitter spreads retries out so several
 * failing items (or several app instances) don't hammer a source in lockstep.
 * `attempt` is 1 for the first retry.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  // Never 0: an immediate retry of a network blip rarely helps.
  return Math.max(Math.round(ceiling / 10), Math.round(random() * ceiling));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Errors may carry hints for the job runner (duck-typed, so adapters in other
 * packages don't need to import anything from here):
 * - `retryable: false` — retrying can't help (404, bad credentials).
 * - `retryAfterMs` — the source said how long to wait (HTTP 429 Retry-After).
 */
export function isRetryable(err: unknown): boolean {
  return !(err && typeof err === "object" && (err as { retryable?: unknown }).retryable === false);
}

export function retryAfterMs(err: unknown): number | undefined {
  const value = err && typeof err === "object" ? (err as { retryAfterMs?: unknown }).retryAfterMs : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** An error the runner won't retry within a run (it's still retried on the next run). */
export class NonRetryableError extends Error {
  readonly retryable = false;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
