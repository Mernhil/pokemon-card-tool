/**
 * Downloads newly-synced printing images and re-hosts them to R2/MinIO
 * (never hotlinks a source's image), then records the object key on Printing.
 */
export async function syncImages(): Promise<void> {
  // TODO(sprint 2): fetch by externalRef, upload via packages/shared/src/r2.ts.
}
