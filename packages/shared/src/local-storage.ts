import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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

/**
 * Per-user app data directory for everything that isn't the database or
 * MEDIA_DIR: the image cache, secrets.json. The desktop shell sets
 * TCG_VAULT_DATA_DIR to the OS app-data folder (apps/desktop/src-tauri/src/main.rs);
 * in development it defaults to ~/.tcg-vault, outside the repo.
 */
export function appDataDir(): string {
  return process.env.TCG_VAULT_DATA_DIR || join(homedir(), ".tcg-vault");
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

/** Absolute path of a storage key (for deleting a file you own). */
export function mediaFilePath(key: string): string {
  return resolveKey(key);
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

export * from "./media-url";
