// No Node imports here: client components import this file directly
// ("@tcg-vault/shared/src/media-url"); local-storage.ts re-exports it.

/** Served by apps/web/app/media/[...key]/route.ts. */
export function mediaUrl(key: string): string {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}
