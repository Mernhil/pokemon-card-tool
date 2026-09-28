import cron from "node-cron";
import { requestCatalogSync, requestFxRefresh, requestPriceRefresh } from "./background";
import { computeValuations } from "./jobs/compute-valuations";
import { snapshotPortfolios } from "./jobs/snapshot-portfolios";

/**
 * Desktop build has no separate worker process or queue: everything runs as
 * scheduled tasks inside the same Next.js server the Tauri shell spawns.
 * Registered once from instrumentation.ts on server start (which also kicks
 * off the first catalog sync shortly after startup — lib/background.ts).
 */
export function startScheduler(): void {
  // Cheap when there's nothing to do (one set-list request): picks up new
  // sets, retries failed ones, and refreshes sets older than 30 days.
  cron.schedule("17 */6 * * *", () => requestCatalogSync());

  // Hourly: only collection / recently viewed cards whose prices are older
  // than the refresh interval (24 h by default) are fetched.
  cron.schedule("7 * * * *", () => requestPriceRefresh());

  // ECB publishes around 16:00 CET on working days; the job skips fresh rates.
  cron.schedule("37 */6 * * *", () => requestFxRefresh());

  // Snapshot at least once a day even when nothing else ran.
  cron.schedule("0 4 * * *", () =>
    runSafely("valuations", async () => {
      await computeValuations();
      await snapshotPortfolios();
    }),
  );
}

async function runSafely(name: string, job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (err) {
    console.error(`[scheduler] ${name} failed:`, err);
  }
}
