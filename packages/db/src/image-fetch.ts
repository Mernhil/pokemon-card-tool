/**
 * How card scans are downloaded: one candidate URL after another, politely.
 *
 * - At most {@link MAX_CONCURRENT_DOWNLOADS} requests in flight, process-wide
 *   (a grid renders 100+ lazy <img> at once).
 * - 429 / 5xx / timeouts / network errors are retried with exponential
 *   backoff (honouring Retry-After); a 404 means "not this one" and moves on.
 * - A confirmed 404 is remembered for {@link NOT_FOUND_TTL_MS}, so a card the
 *   sources don't have isn't asked about again on every view.
 * - Every try is recorded, so the UI can say what was tried and why it failed.
 */

export const MAX_CONCURRENT_DOWNLOADS = 6;
export const NOT_FOUND_TTL_MS = 6 * 3_600_000;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type AttemptOutcome =
  | "ok"
  | "not-found" // HTTP 404 (remembered for a while)
  | "known-missing" // skipped: a recent 404 is still remembered
  | "rate-limited" // HTTP 429
  | "server-error" // HTTP 5xx
  | "timeout"
  | "network"
  | "not-image" // 200, but not an image
  | "too-big"
  | "http-error"; // any other non-2xx

export interface Attempt {
  url: string;
  outcome: AttemptOutcome;
  status?: number;
  /** How many requests it took (1 = no retries). */
  tries?: number;
}

export interface FetchedImage {
  body: Buffer;
  contentType: string;
  url: string;
}

export interface FetchImageOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Extra tries after a transient failure. Default 2. */
  retries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** "HEAD" probes without downloading the body (used by the image report). */
  method?: "GET" | "HEAD";
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  notFoundTtlMs?: number;
  /** The shared concurrency limit (default), a custom one, or null for none. */
  limiter?: Limiter | null;
}

export interface FetchImageResult {
  image: FetchedImage | null;
  attempts: Attempt[];
  /** Some failure was transient (worth trying again soon), not a plain "not there". */
  transient: boolean;
}

// ---------- concurrency limit ----------

export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;
      try {
        return await task();
      } finally {
        // Hand the slot straight to the next waiter, or free it.
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    },
  };
}

const sharedLimiter = createLimiter(MAX_CONCURRENT_DOWNLOADS);

// ---------- negative cache (per URL) ----------

const notFound = new Map<string, number>();

export function clearNotFoundCache(): void {
  notFound.clear();
}

function knownMissing(url: string, now: number): boolean {
  const until = notFound.get(url);
  if (until === undefined) return false;
  if (until <= now) {
    notFound.delete(url);
    return false;
  }
  return true;
}

// ---------- fetching ----------

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransient(outcome: AttemptOutcome): boolean {
  return (
    outcome === "rate-limited" ||
    outcome === "server-error" ||
    outcome === "timeout" ||
    outcome === "network"
  );
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

interface OneTry {
  outcome: AttemptOutcome;
  status?: number;
  image?: FetchedImage;
  retryAfterMs?: number;
}

async function tryOnce(url: string, options: FetchImageOptions, timeoutMs: number): Promise<OneTry> {
  const fetchImpl = options.fetch ?? fetch;
  const method = options.method ?? "GET";
  try {
    const res = await fetchImpl(url, { method, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404 || res.status === 410) {
      return { outcome: "not-found", status: res.status };
    }
    if (res.status === 429) {
      return { outcome: "rate-limited", status: 429, retryAfterMs: parseRetryAfter(res) };
    }
    if (res.status >= 500) {
      return { outcome: "server-error", status: res.status, retryAfterMs: parseRetryAfter(res) };
    }
    if (!res.ok) return { outcome: "http-error", status: res.status };
    const contentType = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("image/")) return { outcome: "not-image", status: res.status };
    if (method === "HEAD") {
      return {
        outcome: "ok",
        status: res.status,
        image: { body: Buffer.alloc(0), contentType, url },
      };
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) return { outcome: "not-image", status: res.status };
    if (body.length > MAX_IMAGE_BYTES) return { outcome: "too-big", status: res.status };
    return { outcome: "ok", status: res.status, image: { body, contentType, url } };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { outcome: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

/**
 * The first candidate that has an image, or null with a record of every try.
 * Never throws.
 */
export async function fetchFirstImage(
  urls: string[],
  options: FetchImageOptions = {},
): Promise<FetchImageResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 2;
  const base = options.backoffBaseMs ?? 500;
  const max = options.backoffMaxMs ?? 8_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const ttl = options.notFoundTtlMs ?? NOT_FOUND_TTL_MS;
  const limiter = options.limiter === undefined ? sharedLimiter : options.limiter;
  const attempts: Attempt[] = [];
  let transient = false;

  for (const url of urls) {
    if (knownMissing(url, now())) {
      attempts.push({ url, outcome: "known-missing" });
      continue;
    }
    let result: OneTry;
    let tries = 0;
    for (;;) {
      tries++;
      const run = () => tryOnce(url, options, timeoutMs);
      result = limiter ? await limiter.run(run) : await run();
      if (!isTransient(result.outcome) || tries > retries) break;
      const backoff = Math.min(max, base * 2 ** (tries - 1));
      await sleep(Math.min(max, result.retryAfterMs ?? backoff));
    }
    attempts.push({ url, outcome: result.outcome, status: result.status, tries });
    if (result.outcome === "not-found") notFound.set(url, now() + ttl);
    if (isTransient(result.outcome)) transient = true;
    if (result.outcome === "ok" && result.image) return { image: result.image, attempts, transient };
  }
  return { image: null, attempts, transient };
}

// ---------- explaining what happened ----------

/** "TCGdex", "pokemontcg.io", ... for a URL, for messages. */
export function sourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("tcgdex.net")) return "TCGdex";
    if (host.endsWith("pokemontcg.io")) return "pokemontcg.io";
    if (host.endsWith("optcgapi.com")) return "optcgapi.com";
    if (host.endsWith("ygoprodeck.com")) return "YGOPRODeck";
    return host;
  } catch {
    return "source";
  }
}

const OUTCOME_TEXT: Record<AttemptOutcome, string> = {
  ok: "ok",
  "not-found": "not found (404)",
  "known-missing": "not found earlier (404)",
  "rate-limited": "rate limited (429)",
  "server-error": "server error",
  timeout: "timed out",
  network: "network error",
  "not-image": "not an image",
  "too-big": "file too big",
  "http-error": "HTTP error",
};

/** One line for a tooltip: what was tried and why it failed. */
export function explainAttempts(attempts: Attempt[]): string {
  if (attempts.length === 0) return "No image address is known for this card.";
  // One entry per source, with the worst thing that happened to it.
  const bySource = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const label = sourceLabel(a.url);
    bySource.set(label, [...(bySource.get(label) ?? []), a]);
  }
  const parts = [...bySource].map(([source, list]) => {
    const worst = list.find((a) => isTransient(a.outcome)) ?? list[list.length - 1]!;
    const text =
      worst.outcome === "server-error" && worst.status
        ? `server error ${worst.status}`
        : OUTCOME_TEXT[worst.outcome];
    const tries = worst.tries && worst.tries > 1 ? ` after ${worst.tries} tries` : "";
    return `${source}: ${text}${tries}`;
  });
  return `Tried ${parts.join("; ")}.`;
}

export type Bucket = "ok" | "404" | "429" | "5xx" | "timeout" | "non-image" | "network" | "other";

/** What to call a printing whose candidates all failed: the most telling attempt wins. */
export function bucketFor(attempts: Attempt[], ok: boolean): Bucket {
  if (ok) return "ok";
  const outcomes = attempts.map((a) => a.outcome);
  if (outcomes.includes("rate-limited")) return "429";
  if (outcomes.includes("server-error")) return "5xx";
  if (outcomes.includes("timeout")) return "timeout";
  if (outcomes.includes("network")) return "network";
  if (outcomes.includes("not-image")) return "non-image";
  if (outcomes.every((o) => o === "not-found" || o === "known-missing")) return "404";
  return "other";
}
