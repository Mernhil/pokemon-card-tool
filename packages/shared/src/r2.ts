import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * S3-compatible client for object storage. Points at MinIO locally
 * (STORAGE_ENDPOINT) and Cloudflare R2 in production — same API either way.
 */
export function createStorageClient(): S3Client {
  return new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? "auto",
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "",
    },
  });
}

const bucket = () => process.env.STORAGE_BUCKET ?? "tcg-vault-media";

export async function putObject(
  client: S3Client,
  key: string,
  body: Uint8Array | Buffer,
  contentType?: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function signedGetUrl(client: S3Client, key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: expiresInSeconds,
  });
}
