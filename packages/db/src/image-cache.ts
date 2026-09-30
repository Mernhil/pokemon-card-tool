import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appDataDir, getFile } from "@tcg-vault/shared";
import { pokemonImageCandidates } from "@tcg-vault/sources";
import { prisma } from "./client";
import {
  explainAttempts,
  fetchFirstImage,
  type Attempt,
  type FetchImageOptions,
} from "./image-fetch";

/**
 * Lazy on-disk cache of card scans. Nothing is bulk-downloaded: the media
 * route (apps/web/app/media/[...key]/route.ts) asks for a printing's image,
 * which is served from disk when cached, or fetched from the printing's
 * remote URLs (Printing.imageUrls, plus constructed CDN candidates), stored,
 * and served.
 *
 * - A scan the user supplied (Printing.customImageKey) always wins.
 * - Lives in the app data directory (TCG_VAULT_DATA_DIR/image-cache), never the repo.
 * - File names are derived from the printing id only (no URL or card text).
 * - Size-capped (500 MB by default) with least-recently-used eviction —
 *   except images of cards in the collection, which are pinned.
 * - A failed download is never cached: the caller shows a placeholder and
 *   the next view tries again. Downloads are rate-limited, retried and
 *   negatively cached (packages/db/src/image-fetch.ts).
 */

export const DEFAULT_IMAGE_CACHE_MAX_BYTES = 500 * 1024 * 1024;
/** Don't write to the DB on every single view; LRU at hour resolution is plenty. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** After a transient failure, don't try the same card again for this long. */
const FAILURE_COOLDOWN_MS = 30_000;

export interface ImageCacheOptions {
  /** Cache directory; defaults to IMAGE_CACHE_DIR or <app data>/image-cache. */
  dir?: string;
  /** Size cap; defaults to IMAGE_CACHE_MAX_MB (in MB) or 500 MB. */
  maxBytes?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** Retry/backoff knobs, mainly for tests. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CardImage {
  body: Buffer;
  contentType: string;
  from: "cache" | "remote" | "custom" | "sibling";
}

export type ImageStatus =
  | "custom"
  | "cache"
  | "remote"
  /** No scan of its own: the art of another printing of the same card (a reprint's original). */
  | "sibling"
  /** No candidate URL at all for this card. */
  | "no-source"
  /** Every candidate source answered 404. */
  | "not-found"
  /** Sources failed in a way that may pass (429, 5xx, timeout, network). */
  | "failed";

export interface ImageResult {
  image: CardImage | null;
  status: ImageStatus;
  attempts: Attempt[];
  /** What was tried and why it failed; empty when an image was found. */
  reason: string;
}

export function imageCacheDir(options: ImageCacheOptions = {}): string {
  return options.dir ?? process.env.IMAGE_CACHE_DIR ?? join(appDataDir(), "image-cache");
}

export function imageCacheMaxBytes(options: ImageCacheOptions = {}): number {
  if (options.maxBytes !== undefined) return options.maxBytes;
  const mb = Number(process.env.IMAGE_CACHE_MAX_MB);
  return Number.isFinite(mb) && mb > 0
    ? Math.round(mb * 1024 * 1024)
    : DEFAULT_IMAGE_CACHE_MAX_BYTES;
}

/** Content-safe cache file name for a printing: its id with anything unusual replaced. */
export function cacheFileName(printingId: string): string {
  const safe = printingId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  if (!safe) throw new Error("empty printing id");
  return `${safe}.img`;
}

export function parseImageUrls(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
      : [];
  } catch {
    return [];
  }
}

const CUSTOM_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export interface CandidatePrinting {
  imageUrls: string | null;
  collectorNumber: string;
  set: { code: string; series: string | null; game: { slug: string } };
}

/**
 * Every URL worth trying for a printing: what the catalog stored first (best
 * source first), then, for Pokémon, constructed TCGdex / pokemontcg.io CDN
 * addresses — so a card the sync found no image for, or whose stored URLs
 * 404, still gets a fair chance without a slow API lookup.
 */
export function imageCandidatesFor(printing: CandidatePrinting): string[] {
  const known = parseImageUrls(printing.imageUrls);
  if (printing.set.game.slug !== "pokemon") return known;
  return pokemonImageCandidates(
    {
      setCode: printing.set.code,
      series: printing.set.series,
      collectorNumber: printing.collectorNumber,
    },
    known,
  );
}

// What happened last time per printing, for tooltips and the short cool-down.
const lastResults = new Map<string, { at: number; result: ImageResult }>();
const MAX_REMEMBERED = 2_000;

function remember(printingId: string, result: ImageResult, now: number): void {
  if (lastResults.size >= MAX_REMEMBERED) {
    const oldest = lastResults.keys().next().value;
    if (oldest !== undefined) lastResults.delete(oldest);
  }
  lastResults.delete(printingId);
  lastResults.set(printingId, { at: now, result });
}

/** What the last attempt for this card found out (why no image), if it was tried in this session. */
export function lastImageResult(printingId: string): ImageResult | null {
  return lastResults.get(printingId)?.result ?? null;
}

export function clearImageResults(): void {
  lastResults.clear();
}

const inFlight = new Map<string, Promise<ImageResult>>();

/**
 * A printing's scan, from the cache or freshly downloaded (then cached).
 * Returns null — never throws — when there's no image to show; nothing is
 * cached then. {@link getCardImageResult} also says why.
 */
export async function getCardImage(
  printingId: string,
  options: ImageCacheOptions = {},
): Promise<CardImage | null> {
  return (await getCardImageResult(printingId, options)).image;
}

export async function getCardImageResult(
  printingId: string,
  options: ImageCacheOptions = {},
): Promise<ImageResult> {
  // Several <img> tags for the same card at once share one download.
  const key = `${imageCacheDir(options)}\u0000${printingId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = loadWithSiblingFallback(printingId, options).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * A printing with no scan of its own (a reprint the source hasn't scanned yet,
 * like the 30th Celebration's Classic Collection) shows the art of the printing
 * it reprints: they share one Card row. Nothing is cached under the reprint's
 * own key, so its real scan is picked up as soon as a source has it.
 */
async function loadWithSiblingFallback(
  printingId: string,
  options: ImageCacheOptions,
): Promise<ImageResult> {
  const own = await loadCardImage(printingId, options);
  if (own.image || (own.status !== "no-source" && own.status !== "not-found")) return own;

  const printing = await prisma.printing.findUnique({
    where: { id: printingId },
    select: { cardId: true },
  });
  if (!printing) return own;
  const siblings = await prisma.printing.findMany({
    where: { cardId: printing.cardId, id: { not: printingId } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 6,
  });
  for (const sibling of siblings) {
    const result = await loadCardImage(sibling.id, options);
    if (result.image) {
      return {
        image: { ...result.image, from: "sibling" },
        status: "sibling",
        attempts: own.attempts,
        reason: "",
      };
    }
  }
  return own;
}

const none = (status: ImageStatus, attempts: Attempt[], reason: string): ImageResult => ({
  image: null,
  status,
  attempts,
  reason,
});

async function loadCardImage(printingId: string, options: ImageCacheOptions): Promise<ImageResult> {
  const now = options.now ?? (() => new Date());
  const dir = imageCacheDir(options);
  const file = cacheFileName(printingId);
  const path = join(dir, file);

  const printing = await prisma.printing.findUnique({
    where: { id: printingId },
    select: {
      imageUrls: true,
      customImageKey: true,
      collectorNumber: true,
      set: { select: { code: true, series: true, game: { select: { slug: true } } } },
    },
  });

  // 1. The user's own scan beats everything.
  if (printing?.customImageKey) {
    try {
      const body = await getFile(printing.customImageKey);
      const ext = printing.customImageKey.split(".").pop()?.toLowerCase() ?? "";
      return {
        image: { body, contentType: CUSTOM_CONTENT_TYPES[ext] ?? "image/png", from: "custom" },
        status: "custom",
        attempts: [],
        reason: "",
      };
    } catch {
      // The file is gone (deleted by hand): fall back to the normal sources.
    }
  }

  // 2. The on-disk cache.
  const entry = await prisma.imageCacheEntry.findUnique({ where: { key: file } });
  if (entry) {
    try {
      const body = await readFile(path);
      if (now().getTime() - entry.lastAccessedAt.getTime() > TOUCH_INTERVAL_MS) {
        await prisma.imageCacheEntry.update({
          where: { key: file },
          data: { lastAccessedAt: now() },
        });
      }
      return {
        image: { body, contentType: entry.contentType, from: "cache" },
        status: "cache",
        attempts: [],
        reason: "",
      };
    } catch {
      // Row without a file (deleted by hand, disk cleanup): download it again.
      await prisma.imageCacheEntry.deleteMany({ where: { key: file } });
    }
  }

  if (!printing) return none("no-source", [], "This card no longer exists.");

  // A transient failure a moment ago: don't hammer the sources on every re-render.
  const recent = lastResults.get(printingId);
  if (
    recent &&
    recent.result.status === "failed" &&
    now().getTime() - recent.at < FAILURE_COOLDOWN_MS
  ) {
    return recent.result;
  }

  // 3. The sources.
  const urls = imageCandidatesFor(printing);
  if (urls.length === 0) {
    const result = none("no-source", [], "No image address is known for this card.");
    remember(printingId, result, now().getTime());
    return result;
  }
  const fetchOptions: FetchImageOptions = {
    fetch: options.fetch,
    timeoutMs: options.timeoutMs ?? 20_000,
    retries: options.retries,
    sleep: options.sleep,
    now: () => now().getTime(),
  };
  const { image, attempts, transient } = await fetchFirstImage(urls, fetchOptions);
  if (!image) {
    const result = none(
      transient ? "failed" : "not-found",
      attempts,
      transient
        ? `${explainAttempts(attempts)} It will be tried again.`
        : `${explainAttempts(attempts)} The sources don't have this card's scan.`,
    );
    remember(printingId, result, now().getTime());
    console.warn(`[image-cache] ${printingId}: ${result.reason}`);
    return result;
  }

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path, image.body);
    const data = {
      printingId,
      bytes: image.body.length,
      contentType: image.contentType,
      lastAccessedAt: now(),
    };
    await prisma.imageCacheEntry.upsert({
      where: { key: file },
      update: data,
      create: { key: file, createdAt: now(), ...data },
    });
    await evictImageCache(options);
  } catch (err) {
    // Couldn't cache (disk full, read-only): still show the image this time.
    console.warn(`[image-cache] couldn't store ${printingId}:`, err);
  }
  lastResults.delete(printingId);
  return {
    image: { body: image.body, contentType: image.contentType, from: "remote" },
    status: "remote",
    attempts,
    reason: "",
  };
}

/** Printing ids whose images must never be evicted: every card in the collection. */
export async function pinnedPrintingIds(): Promise<Set<string>> {
  const rows = await prisma.printing.findMany({
    where: { variants: { some: { collection: { some: {} } } } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

let evicting: Promise<unknown> = Promise.resolve();

/**
 * Deletes least-recently-used images until the cache fits its cap, skipping
 * pinned (collection) images. If pinned images alone exceed the cap, they
 * stay and the cache is simply over it.
 */
export function evictImageCache(
  options: ImageCacheOptions = {},
): Promise<{ evicted: number; freedBytes: number; totalBytes: number }> {
  // One eviction at a time, so two concurrent downloads don't both delete.
  const run = evicting.then(() => evictNow(options));
  evicting = run.catch(() => {});
  return run;
}

async function evictNow(options: ImageCacheOptions) {
  const maxBytes = imageCacheMaxBytes(options);
  const dir = imageCacheDir(options);
  const agg = await prisma.imageCacheEntry.aggregate({ _sum: { bytes: true } });
  let totalBytes = agg._sum.bytes ?? 0;
  let evicted = 0;
  let freedBytes = 0;
  if (totalBytes <= maxBytes) return { evicted, freedBytes, totalBytes };

  const pinned = await pinnedPrintingIds();
  const candidates = await prisma.imageCacheEntry.findMany({
    orderBy: { lastAccessedAt: "asc" },
    select: { key: true, bytes: true, printingId: true },
  });
  for (const entry of candidates) {
    if (totalBytes <= maxBytes) break;
    if (entry.printingId && pinned.has(entry.printingId)) continue;
    await rm(join(dir, entry.key), { force: true });
    await prisma.imageCacheEntry.delete({ where: { key: entry.key } }).catch(() => {});
    totalBytes -= entry.bytes;
    freedBytes += entry.bytes;
    evicted++;
  }
  return { evicted, freedBytes, totalBytes };
}

export async function imageCacheStats(): Promise<{
  files: number;
  bytes: number;
  pinnedBytes: number;
}> {
  const [agg, pinned] = await Promise.all([
    prisma.imageCacheEntry.aggregate({ _sum: { bytes: true }, _count: { _all: true } }),
    pinnedPrintingIds(),
  ]);
  const pinnedAgg = await prisma.imageCacheEntry.aggregate({
    where: { printingId: { in: [...pinned] } },
    _sum: { bytes: true },
  });
  return {
    files: agg._count._all,
    bytes: agg._sum.bytes ?? 0,
    pinnedBytes: pinnedAgg._sum.bytes ?? 0,
  };
}
