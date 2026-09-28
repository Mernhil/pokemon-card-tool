import { runSync } from "../sync-runner";

/**
 * Re-syncs every set already in the local catalog from TCGdex. TCGdex bundles
 * Cardmarket + TCGplayer prices with each card, so this is how prices get
 * refreshed; it also recomputes valuations and today's portfolio snapshot.
 * Shares the Sync page's one-at-a-time lock (lib/sync-runner.ts).
 */
export async function syncPrices(): Promise<void> {
  await runSync(null, (event) => {
    if (event.type === "log") console.log(`[sync-prices] ${event.line}`);
    if (event.type === "summary") console.log(`[sync-prices] done, ok=${event.ok}`);
    if (event.type === "error") console.log(`[sync-prices] ${event.message}`);
  });
}
