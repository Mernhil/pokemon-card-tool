import { createHash } from "node:crypto";

/**
 * Errors carry hints the job runner (packages/db/src/jobs/runner.ts) reads
 * duck-typed: `retryable: false` (don't retry in this run), `retryAfterMs`
 * (wait this long), `fatal: true` (stop this provider's whole run — e.g. bad
 * credentials would fail every card the same way).
 */
export class ProviderError extends Error {
  retryable = true;
  fatal = false;
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
  }
}

export class RateLimitedError extends ProviderError {
  constructor(
    provider: string,
    readonly retryAfterMs: number,
  ) {
    super(provider, `rate limited, retry in ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

/** Missing/invalid/expired credentials, or an app that isn't approved for this API. */
export class AuthError extends ProviderError {
  override retryable = false;
  override fatal = true;
}

export class NotConfiguredError extends ProviderError {
  override retryable = false;
  override fatal = true;
  constructor(provider: string, what = "API key not set") {
    super(provider, what);
  }
}

export class HttpError extends ProviderError {
  constructor(
    provider: string,
    readonly status: number,
    message: string,
  ) {
    super(provider, message);
    // 4xx other than timeout/rate limit won't get better by retrying now.
    this.retryable = status >= 500 || status === 408;
  }
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. Falls back to `fallbackMs`. */
export function parseRetryAfter(
  value: string | null,
  fallbackMs: number,
  now = Date.now(),
): number {
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 3_600_000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - now), 3_600_000);
  return fallbackMs;
}

export function hashPayload(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Spaces calls to one provider at least `minIntervalMs` apart (per process),
 * so bursts of cards never exceed its rate limit.
 */
export function createThrottle(minIntervalMs: number): () => Promise<void> {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + minIntervalMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}

export interface RequestOptions {
  provider: string;
  fetch?: typeof fetch;
  throttle?: () => Promise<void>;
  timeoutMs?: number;
}

/**
 * GET/POST expecting JSON, mapping failures onto the errors above. Never logs
 * request headers (they carry tokens).
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<{ data: T; hash: string }> {
  await options.throttle?.();
  const fetchImpl = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch (err) {
    throw new ProviderError(
      options.provider,
      `couldn't reach ${new URL(url).host}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = await res.text();
  if (res.status === 429) {
    throw new RateLimitedError(
      options.provider,
      parseRetryAfter(res.headers.get("retry-after"), 60_000),
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(
      options.provider,
      `${res.status === 401 ? "invalid or expired credentials" : "access denied"} (HTTP ${res.status}): ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    throw new HttpError(
      options.provider,
      res.status,
      `HTTP ${res.status} from ${new URL(url).pathname}: ${text.slice(0, 200)}`,
    );
  }
  try {
    return { data: JSON.parse(text) as T, hash: hashPayload(text) };
  } catch {
    throw new HttpError(options.provider, res.status, `invalid JSON from ${new URL(url).pathname}`);
  }
}

/** Median of a non-empty list. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Major units (12.34, "12.34") -> minor units (1234) for 2-decimal currencies; null for garbage. */
export function toMinorUnits(value: unknown, decimals = 2): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10 ** decimals);
}
