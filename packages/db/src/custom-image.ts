import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { mediaFilePath, putFile, remoteImageKey } from "@tcg-vault/shared";
import { prisma } from "./client";
import { cacheFileName, imageCacheDir } from "./image-cache";

/**
 * Custom card images ("Set custom image"): a scan the user supplies for a
 * printing the sources have none for. Stored in the media directory under
 * `custom/`, recorded on Printing.customImageKey, and served ahead of every
 * remote source by the image cache. The catalog sync never writes that
 * column, so a re-sync keeps them.
 */

export const MAX_CUSTOM_IMAGE_BYTES = 10 * 1024 * 1024;
export const CUSTOM_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type CustomImageType = (typeof CUSTOM_IMAGE_TYPES)[number];

const EXTENSIONS: Record<CustomImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The real type of an image from its first bytes (never trust a file name or declared type). */
export function sniffImageType(bytes: Uint8Array): CustomImageType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === "RIFF" &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === "WEBP"
  )
    return "image/webp";
  return null;
}

export type CustomImageError = "empty" | "too-big" | "not-an-image" | "no-such-card";

const ERROR_TEXT: Record<CustomImageError, string> = {
  empty: "That file is empty.",
  "too-big": `That image is too big (the limit is ${MAX_CUSTOM_IMAGE_BYTES / 1024 / 1024} MB).`,
  "not-an-image": "That isn't a PNG, JPEG or WebP image.",
  "no-such-card": "That card no longer exists.",
};

export function customImageErrorText(error: CustomImageError): string {
  return ERROR_TEXT[error];
}

/** Pure check of size and type. */
export function validateCustomImage(
  bytes: Uint8Array,
): { ok: true; type: CustomImageType } | { ok: false; error: CustomImageError } {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_CUSTOM_IMAGE_BYTES) return { ok: false, error: "too-big" };
  const type = sniffImageType(bytes);
  return type ? { ok: true, type } : { ok: false, error: "not-an-image" };
}

async function removeStoredFile(key: string | null): Promise<void> {
  if (!key || !key.startsWith("custom/")) return;
  await rm(mediaFilePath(key), { force: true }).catch(() => {});
}

/** Drops any downloaded copy so nothing stale outlives a change of image. */
async function dropCachedCopy(printingId: string): Promise<void> {
  const file = cacheFileName(printingId);
  await prisma.imageCacheEntry.deleteMany({ where: { key: file } });
  await rm(join(imageCacheDir(), file), { force: true }).catch(() => {});
}

export async function setCustomImage(
  printingId: string,
  bytes: Uint8Array,
): Promise<{ ok: true; key: string } | { ok: false; error: CustomImageError }> {
  const checked = validateCustomImage(bytes);
  if (!checked.ok) return checked;
  const printing = await prisma.printing.findUnique({
    where: { id: printingId },
    select: { customImageKey: true },
  });
  if (!printing) return { ok: false, error: "no-such-card" };

  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  const key = `custom/${printingId}-${hash}.${EXTENSIONS[checked.type]}`;
  await putFile(key, bytes);
  await prisma.printing.update({
    where: { id: printingId },
    // The lazy key makes every view go through the image cache, which serves the custom file first.
    data: { customImageKey: key, imageKey: remoteImageKey(printingId) },
  });
  if (printing.customImageKey && printing.customImageKey !== key)
    await removeStoredFile(printing.customImageKey);
  await dropCachedCopy(printingId);
  return { ok: true, key };
}

export async function removeCustomImage(printingId: string): Promise<boolean> {
  const printing = await prisma.printing.findUnique({
    where: { id: printingId },
    select: { customImageKey: true, imageUrls: true, set: { select: { game: { select: { slug: true } } } } },
  });
  if (!printing?.customImageKey) return false;
  // Back to the normal sources; Pokémon printings keep the lazy key (constructed CDN candidates).
  const keepKey = !!printing.imageUrls || printing.set.game.slug === "pokemon";
  await prisma.printing.update({
    where: { id: printingId },
    data: { customImageKey: null, imageKey: keepKey ? remoteImageKey(printingId) : null },
  });
  await removeStoredFile(printing.customImageKey);
  return true;
}

// ---------- import from a folder ----------

export interface ImportFile {
  name: string;
}

export interface ImportMatch {
  fileName: string;
  printingId: string | null;
  collectorNumber: string | null;
  cardName: string | null;
  /** Why a file wasn't matched ("no card numbered 12 in this set", "matches several cards"). */
  problem: string | null;
}

/** "004", "4", "4.png", "004-charizard.jpg", "SVP 004" -> the number part, without padding. */
export function numberFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, "");
  // The last number-like token wins ("30th 004" -> 004, "TG05" -> TG05).
  const tokens = base.match(/[A-Za-z]{0,4}\d+/g);
  return tokens ? tokens[tokens.length - 1]! : null;
}

function normalizeNumber(n: string): string {
  const m = n.match(/^([A-Za-z]*)0*(\d+)$/);
  return m ? `${m[1]!.toUpperCase()}${m[2]}` : n.toUpperCase();
}

/**
 * Pure: matches files to the printings of one set by collector number (the
 * part before "/", padding ignored). Files that match no card, or several
 * (e.g. alt arts), are reported instead of guessed.
 */
export function matchImageFiles(
  files: ImportFile[],
  printings: Array<{ id: string; collectorNumber: string; cardName: string }>,
): ImportMatch[] {
  const byNumber = new Map<string, typeof printings>();
  for (const p of printings) {
    const key = normalizeNumber((p.collectorNumber.split("/")[0] ?? p.collectorNumber).trim());
    byNumber.set(key, [...(byNumber.get(key) ?? []), p]);
  }
  return files.map((f): ImportMatch => {
    const raw = numberFromFileName(f.name);
    const miss = (problem: string): ImportMatch => ({
      fileName: f.name,
      printingId: null,
      collectorNumber: null,
      cardName: null,
      problem,
    });
    if (!raw) return miss("No card number in the file name.");
    const hits = byNumber.get(normalizeNumber(raw)) ?? [];
    if (hits.length === 0) return miss(`No card numbered ${raw} in this set.`);
    if (hits.length > 1) return miss(`${hits.length} cards share the number ${raw}.`);
    const hit = hits[0]!;
    return {
      fileName: f.name,
      printingId: hit.id,
      collectorNumber: hit.collectorNumber,
      cardName: hit.cardName,
      problem: null,
    };
  });
}
