import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appDataDir } from "@tcg-vault/shared";
import { prisma } from "./client";

/**
 * Lazy on-disk cache of card scans. Nothing is bulk-downloaded: the media
 * route (apps/web/app/media/[...key]/route.ts) asks for a printing's image,
 * which is served from disk when cached, or fetched from the printing's
 * remote URLs (Printing.imageUrls), stored, and served.
 *
 * - Lives in the app data directory (TCG_VAULT_DATA_DIR/image-cache), never the repo.
 * - File names are derived from the printing id only (no URL or card text).
 * - Size-capped (500 MB by default) with least-recently-used eviction —
 *   except images of cards in the collection, which are pinned.
 * - A failed download is never cached: the caller shows a placeholder and
 *   the next view tries again.
 */

export const DEFAULT_IMAGE_CACHE_MAX_BYTES = 500 * 1024 * 1024;
/** Refuse absurd responses (a card scan is ~100-500 KB). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Don't write to the DB on every single view; LRU at hour resolution is plenty. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface ImageCacheOptions {
  /** Cache directory; defaults to IMAGE_CACHE_DIR or <app data>/image-cache. */
  dir?: string;
  /** Size cap; defaults to IMAGE_CACHE_MAX_MB (in MB) or 500 MB. */
  maxBytes?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export interface CardImage {
  body: Buffer;
  contentType: string;
  from: "cache" | "remote";
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

function parseUrls(json: string | null): string[] {
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

/**
 * Downloads the first candidate URL that exists. A 404 means "not this one,
 * try the next"; anything else (network, 5xx, not an image, too big)
 * throws. null when the source simply has none of the candidates.
 */
async function download(
  urls: string[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ body: Buffer; contentType: string } | null> {
  for (const url of urls) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new Error(`GET ${url} returned ${contentType || "no content type"}, not an image`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) throw new Error(`GET ${url} returned an empty body`);
    if (body.length > MAX_IMAGE_BYTES)
      throw new Error(`GET ${url} is ${body.length} bytes, too big`);
    return { body, contentType };
  }
  return null;
}

const inFlight = new Map<string, Promise<CardImage | null>>();

/**
 * A printing's scan, from the cache or freshly downloaded (then cached).
 * Returns null — never throws — when there's no image to show (no URLs, the
 * source doesn't have it, network down, bad response); nothing is cached then.
 */
export async function getCardImage(
  printingId: string,
  options: ImageCacheOptions = {},
): Promise<CardImage | null> {
  // Several <img> tags for the same card at once share one download.
  const key = `${imageCacheDir(options)}\u0000${printingId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = loadCardImage(printingId, options).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function loadCardImage(
  printingId: string,
  options: ImageCacheOptions,
): Promise<CardImage | null> {
  const now = options.now ?? (() => new Date());
  const dir = imageCacheDir(options);
  const file = cacheFileName(printingId);
  const path = join(dir, file);

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
      return { body, contentType: entry.contentType, from: "cache" };
    } catch {
      // Row without a file (deleted by hand, disk cleanup): download it again.
      await prisma.imageCacheEntry.deleteMany({ where: { key: file } });
    }
  }

  const printing = await prisma.printing.findUnique({
    where: { id: printingId },
    select: { imageUrls: true },
  });
  const urls = parseUrls(printing?.imageUrls ?? null);
  if (urls.length === 0) return null;

  let image: { body: Buffer; contentType: string } | null;
  try {
    image = await download(urls, options.fetch ?? fetch, options.timeoutMs ?? 20_000);
  } catch (err) {
    console.warn(
      `[image-cache] ${printingId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  if (!image) return null;

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
  return { ...image, from: "remote" };
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
