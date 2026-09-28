// No Node imports here: client components import this file directly
// ("@tcg-vault/shared/src/media-url"); local-storage.ts re-exports it.

/** Served by apps/web/app/media/[...key]/route.ts. */
export function mediaUrl(key: string): string {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Printing.imageKey of a scan that isn't on disk yet: the media route fetches
 * it from Printing.imageUrls on first view and keeps it in the image cache.
 */
export const REMOTE_IMAGE_PREFIX = "remote/";

export function remoteImageKey(printingId: string): string {
  return `${REMOTE_IMAGE_PREFIX}${printingId}`;
}
