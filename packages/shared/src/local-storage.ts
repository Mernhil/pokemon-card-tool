import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

/**
 * Card images and user photos, kept as plain files under MEDIA_DIR (set to
 * a per-user app-data folder at runtime in the packaged desktop app — see
 * apps/desktop/src-tauri/src/main.rs). No cloud bucket, no CDN: this is a
 * single-machine app, so "storage key" is just a relative file path.
 */
function mediaDir(): string {
  return process.env.MEDIA_DIR ?? "./.media";
}

/** Rejects `..` segments so a bad key can't escape MEDIA_DIR. */
function resolveKey(key: string): string {
  const resolved = normalize(join(mediaDir(), key));
  const root = normalize(mediaDir()) + sep;
  if (!resolved.startsWith(root)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return resolved;
}

export async function putFile(key: string, body: Uint8Array | Buffer): Promise<void> {
  const path = resolveKey(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

export async function getFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function hasFile(key: string): Promise<boolean> {
  try {
    await access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

/** Served by apps/web/app/media/[...key]/route.ts. */
export function mediaUrl(key: string): string {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}
