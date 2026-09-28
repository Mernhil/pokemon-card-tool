import cron from "node-cron";
import { syncPrices } from "./jobs/sync-prices";
import { syncMarketplacePricesJob } from "./jobs/sync-marketplace-prices";
import { computeValuations } from "./jobs/compute-valuations";
import { snapshotPortfolios } from "./jobs/snapshot-portfolios";

/**
 * Desktop build has no separate worker process or queue: everything runs as
 * scheduled tasks inside the same Next.js server the Tauri shell spawns.
 * Registered once from instrumentation.ts on server start.
 *
 * New sets are added by hand from the Sync page (apps/web/app/sync); the
 * nightly job only refreshes what's already there.
 */
export function startScheduler(): void {
  // 03:30 local time: re-sync known sets for fresh prices (also recomputes valuations).
  cron.schedule("30 3 * * *", () => runSafely("sync-prices", syncPrices));

  // 03:50: CardTrader/eBay on top, once TCGdex's own prices are fresh. A
  // no-op until CARDTRADER_API_TOKEN / EBAY_CLIENT_ID+SECRET are set.
  cron.schedule("50 3 * * *", () => runSafely("marketplace-prices", syncMarketplacePricesJob));

  // Snapshot at least once a day even when the price sync failed or had nothing to do.
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
