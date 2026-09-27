import { createHmac } from "node:crypto";

export const IMAGE_SIZES = {
  thumb: 245,
  grid: 512,
  full: 2048,
} as const;

export type ImageSize = keyof typeof IMAGE_SIZES;

function base64Url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(path: string): string {
  const key = Buffer.from(process.env.IMGPROXY_KEY!, "hex");
  const salt = Buffer.from(process.env.IMGPROXY_SALT!, "hex");
  const hmac = createHmac("sha256", key);
  hmac.update(salt);
  hmac.update(path);
  return base64Url(hmac.digest());
}

/**
 * Builds a signed imgproxy URL for one of the three fixed sizes we render
 * everywhere (grid thumbnails, the binder grid, and the full-size viewer).
 * `objectKey` is the R2/MinIO object key (imgproxy is configured with
 * IMGPROXY_USE_S3, so the source is addressed as s3://bucket/key).
 */
export function buildImageUrl(objectKey: string, size: ImageSize): string {
  const width = IMAGE_SIZES[size];
  const source = `s3://${process.env.STORAGE_BUCKET}/${objectKey}`;
  const encodedSource = base64Url(Buffer.from(source));
  const path = `/rs:fit:${width}:${width}:0/${encodedSource}`;
  const signature = sign(path);

  return `${process.env.IMGPROXY_URL}/${signature}${path}`;
}
