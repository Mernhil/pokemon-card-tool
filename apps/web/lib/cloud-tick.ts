import {
  backfillCardDex,
  backfillImageKeys,
  backfillSetCategories,
  backfillSubsets,
  computeValuations,
  ensureBaseData,
  getSettings,
  mergeStraySets,
  refreshFxRates,
  runCatalogSync,
  runPriceRefresh,
  snapshotPortfolio,
} from "@tcg-vault/db";
import { PRICE_PROVIDERS } from "@tcg-vault/shared";
import { catalogAdapters, priceProviders } from "./background";

/**
 * One scheduled slice of background work on Cloudflare (called by the cron
 * trigger through /api/cron/tick). A Worker invocation is short and bounded
 * (subrequests, CPU), so each tick does a little and relies on the job
 * runner's resumable per-item state — the next tick carries on where this
 * one stopped. `budgetMs` is the wall-clock the tick may spend.
 */
export async function runCloudTick(budgetMs = 180_000): Promise<string[]> {
  const log: string[] = [];
  const say = (line: string) => log.push(line);
  const signal = AbortSignal.timeout(budgetMs);
  const settings = await getSettings();
  let changed = false;

  await ensureBaseData();

  // Catalog: one or two stale / pending sets per game per tick.
  for (const adapter of catalogAdapters()) {
    if (signal.aborted) break;
    const result = await runCatalogSync(adapter, {
      concurrency: 1,
      maxItems: 10,
      signal,
      refreshAfterMs: settings.catalogRefreshDays * 86_400_000,
      log: (line) => say(`[catalog:${adapter.game}] ${line}`),
    }).catch((err) => {
      say(`[catalog:${adapter.game}] failed: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    if (result && result.run.succeeded.length > 0) changed = true;
  }

  // Prices: a slice of stale collection / recently viewed cards per provider and game.
  const { providers } = await priceProviders();
  for (const { game } of catalogAdapters()) {
    for (const id of PRICE_PROVIDERS) {
      if (signal.aborted) break;
      if (!settings.providers[id].enabled) continue;
      const result = await runPriceRefresh(providers[id], game, {
        concurrency: 1,
        maxItems: 40,
        signal,
        refreshAfterMs: settings.priceRefreshHours * 3_600_000,
        priceLanguage: settings.priceLanguage,
        log: (line) => say(`[price:${id}:${game}] ${line}`),
      }).catch((err) => {
        say(`[price:${id}:${game}] failed: ${err instanceof Error ? err.message : err}`);
        return null;
      });
      if (result && result.succeeded.length > 0) changed = true;
    }
  }

  await refreshFxRates({ log: (line) => say(`[fx] ${line}`) }).catch((err) =>
    say(`[fx] failed: ${err instanceof Error ? err.message : err}`),
  );

  // Rows synced above need what the desktop app's startup fills in.
  if (changed) {
    await Promise.allSettled([
      backfillImageKeys(),
      mergeStraySets().then(() => backfillSubsets()),
      backfillSetCategories(),
      backfillCardDex(),
    ]);
  }
  // Today's portfolio point exists even when no price changed.
  await computeValuations();
  await snapshotPortfolio();
  say(`done${signal.aborted ? " (budget used up)" : ""}`);
  return log;
}
