import cron from "node-cron";
import { syncCatalog } from "./jobs/sync-catalog";
import { syncImages } from "./jobs/sync-images";
import { syncPrices } from "./jobs/sync-prices";
import { computeValuations } from "./jobs/compute-valuations";
import { snapshotPortfolios } from "./jobs/snapshot-portfolios";

const GAMES = ["pokemon", "yugioh", "one-piece"];
const PRICE_SOURCES = ["cardmarket", "cardtrader", "ebay-browse"];

/**
 * Desktop build has no separate worker process or queue: everything runs as
 * scheduled tasks inside the same Next.js server the Tauri shell spawns.
 * Registered once from instrumentation.ts on server start.
 */
export function startScheduler(): void {
  // 03:00 local time: catalog + images, then prices, then valuations, then the snapshot.
  cron.schedule("0 3 * * *", async () => {
    for (const game of GAMES) await syncCatalog(game);
    await syncImages();
  });

  cron.schedule("30 3 * * *", async () => {
    for (const source of PRICE_SOURCES) await syncPrices(source);
  });

  cron.schedule("0 4 * * *", async () => {
    await computeValuations();
    await snapshotPortfolios();
  });
}
