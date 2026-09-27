import { createRedisConnection } from "./redis";
import { createSyncCatalogQueue, createSyncCatalogWorker } from "./queues/sync-catalog";

const HEARTBEAT_INTERVAL_MS = 30_000;

async function main() {
  const connection = createRedisConnection();

  connection.on("connect", () => console.log("[worker] connected to Redis"));
  connection.on("error", (err) => console.error("[worker] Redis connection error", err));

  const queue = createSyncCatalogQueue(connection);
  const worker = createSyncCatalogWorker(connection);

  worker.on("error", (err) => console.error("[worker] sync-catalog worker error", err));

  setInterval(() => {
    console.log(`[worker] heartbeat ${new Date().toISOString()}`);
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await worker.close();
    await queue.close();
    connection.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal startup error", err);
  process.exit(1);
});
