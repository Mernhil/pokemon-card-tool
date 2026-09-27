import { Queue, Worker, type ConnectionOptions } from "bullmq";

export const SYNC_CATALOG_QUEUE = "sync-catalog";

export function createSyncCatalogQueue(connection: ConnectionOptions) {
  return new Queue(SYNC_CATALOG_QUEUE, { connection });
}

// Empty for Sprint 1: apps/worker just proves it can register a queue and
// pick up jobs. Real per-source sync (packages/sources adapters) lands when
// catalog sync is built.
export function createSyncCatalogWorker(connection: ConnectionOptions) {
  return new Worker(
    SYNC_CATALOG_QUEUE,
    async (job) => {
      console.log(`[sync-catalog] received job ${job.id} (${job.name}) - no-op for now`);
    },
    { connection },
  );
}
