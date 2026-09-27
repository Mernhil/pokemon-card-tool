import { Worker } from "bullmq";
import { connection } from "./queue";
import { syncCatalog } from "./jobs/sync-catalog";
import { syncImages } from "./jobs/sync-images";
import { syncPrices } from "./jobs/sync-prices";
import { computeValuations } from "./jobs/compute-valuations";
import { snapshotPortfolios } from "./jobs/snapshot-portfolios";
import { reindexSearch } from "./jobs/reindex-search";

const handlers: Record<string, (data: unknown) => Promise<void>> = {
  "catalog-sync": (data) => syncCatalog((data as { gameSlug: string }).gameSlug),
  "image-sync": () => syncImages(),
  "price-sync": (data) => syncPrices((data as { sourceSlug: string }).sourceSlug),
  valuation: () => computeValuations(),
  "portfolio-snapshot": () => snapshotPortfolios(),
  "search-reindex": () => reindexSearch(),
};

for (const [queueName, handler] of Object.entries(handlers)) {
  new Worker(queueName, ({ data }) => handler(data), { connection });
  // eslint-disable-next-line no-console
  console.log(`[worker] listening on queue "${queueName}"`);
}
