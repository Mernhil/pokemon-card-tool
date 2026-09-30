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

/** `fatal: true` — every other item would fail the same way (bad credentials): stop the run. */
export function isFatal(err: unknown): boolean {
  return !!(err && typeof err === "object" && (err as { fatal?: unknown }).fatal === true);
}

export function retryAfterMs(err: unknown): number | undefined {
  const value =
    err && typeof err === "object" ? (err as { retryAfterMs?: unknown }).retryAfterMs : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** An error the runner won't retry within a run (it's still retried on the next run). */
export class NonRetryableError extends Error {
  readonly retryable = false;
}

/**
 * The source genuinely can't provide this item (404, empty set, removed) —
 * not a bug and not transient. The runner parks it as `unavailable` with
 * this message as the plain-language reason, and checks again only rarely.
 */
export class SourceUnavailableError extends NonRetryableError {
  readonly unavailable = true;
}

export function isUnavailable(err: unknown): boolean {
  return !!(
    err &&
    typeof err === "object" &&
    (err as { unavailable?: unknown }).unavailable === true
  );
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
