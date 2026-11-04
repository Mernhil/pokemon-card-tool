// Cloudflare Workers build of ./local-storage.ts (swapped in by apps/web/next.config.mjs):
// the same functions, backed by the R2 bucket bound as MEDIA instead of the disk.
import type { R2Bucket } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";

function bucket(): R2Bucket {
  return (getCloudflareContext().env as { MEDIA: R2Bucket }).MEDIA;
}

/** Rejects `..` segments, like the disk version. */
function checked(key: string): string {
  if (key.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return key;
}

/** Workers have no app-data directory; kept so shared callers still type-check. */
export function appDataDir(): string {
  return "/data";
}

export function mediaFilePath(key: string): string {
  return checked(key);
}

export async function putFile(key: string, body: Uint8Array | Buffer): Promise<void> {
  await bucket().put(`media/${checked(key)}`, body);
}

export async function getFile(key: string): Promise<Buffer> {
  const object = await bucket().get(`media/${checked(key)}`);
  if (!object) throw new Error(`ENOENT: ${key}`);
  return Buffer.from(await object.arrayBuffer());
}

export async function hasFile(key: string): Promise<boolean> {
  return (await bucket().head(`media/${checked(key)}`)) !== null;
}

export async function deleteFile(key: string): Promise<void> {
  await bucket().delete(`media/${checked(key)}`);
}

export async function cacheGet(_dir: string, file: string): Promise<Buffer> {
  const object = await bucket().get(`image-cache/${checked(file)}`);
  if (!object) throw new Error(`ENOENT: ${file}`);
  return Buffer.from(await object.arrayBuffer());
}

export async function cachePut(_dir: string, file: string, body: Uint8Array | Buffer): Promise<void> {
  await bucket().put(`image-cache/${checked(file)}`, body);
}

export async function cacheDelete(_dir: string, file: string): Promise<void> {
  await bucket().delete(`image-cache/${checked(file)}`);
}

export * from "./media-url";
