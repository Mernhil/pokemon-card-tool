import {
  computeValuations,
  getSettings,
  readSecrets,
  refreshFxRates,
  runCatalogSync,
  runPriceRefresh,
  snapshotPortfolio,
  type AppSettings,
} from "@tcg-vault/db";
import { PRICE_PROVIDERS, type PriceProviderId } from "@tcg-vault/shared";
import {
  OptcgAdapter,
  TcgdexPokemonAdapter,
  YgoprodeckAdapter,
  createPriceProviders,
  type CatalogSourceAdapter,
  type PriceProvider,
} from "@tcg-vault/sources";

/**
 * Background jobs inside the Next.js server (the desktop app has no separate
 * worker). Every run goes through @tcg-vault/db's job runner, which holds a
 * DB lock, so these helpers only need to avoid piling up runs in-process:
 * asking for a run while one is going just schedules one more afterwards.
 *
 * New games plug in by adding their catalog adapter to CATALOG_ADAPTERS;
 * their prices then refresh through every provider that supports the game.
 */

const CATALOG_ADAPTERS: Array<() => CatalogSourceAdapter> = [
  () => new TcgdexPokemonAdapter(),
  () => new YgoprodeckAdapter(),
  () => new OptcgAdapter(),
];

interface Loop {
  running: boolean;
  again: boolean;
}

// On globalThis so dev-mode module reloads don't start a second loop.
const state = globalThis as unknown as {
  __tcgVaultLoops?: Map<string, Loop>;
  __tcgVaultStarted?: boolean;
};
const loops = (state.__tcgVaultLoops ??= new Map());

export function catalogAdapters(): CatalogSourceAdapter[] {
  return CATALOG_ADAPTERS.map((make) => make());
}

export function catalogAdapter(game = "pokemon"): CatalogSourceAdapter {
  const adapter = catalogAdapters().find((a) => a.game === game);
  if (!adapter) throw new Error(`No catalog source for game "${game}"`);
  return adapter;
}

/**
 * Runs `job` now in the background (never awaited by the caller), or once
 * more right after the current run if one is already going. Errors are
 * logged, never thrown: a background job must not take the server down.
 */
export function requestRun(name: string, job: () => Promise<unknown>): void {
  const loop = loops.get(name) ?? { running: false, again: false };
  loops.set(name, loop);
  if (loop.running) {
    loop.again = true;
    return;
  }
  loop.running = true;
  void (async () => {
    try {
      do {
        loop.again = false;
        try {
          await job();
        } catch (err) {
          console.error(`[background] ${name} failed:`, err);
        }
      } while (loop.again);
    } finally {
      loop.running = false;
    }
  })();
}

export function isRunning(name: string): boolean {
  return loops.get(name)?.running ?? false;
}

const retryTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; failures: number }>();

/**
 * When a run couldn't reach the source (set list failed, or it halted after
 * a streak of failures), try again soon instead of waiting for the 6-hourly
 * schedule: 5 min, doubling up to an hour. A clean run resets it.
 */
function scheduleRetry(name: string, unhealthy: boolean, run: () => void): void {
  const previous = retryTimers.get(name);
  if (previous) clearTimeout(previous.timer);
  if (!unhealthy) {
    retryTimers.delete(name);
    return;
  }
  const failures = (previous?.failures ?? 0) + 1;
  const delay = Math.min(60, 5 * 2 ** (failures - 1)) * 60_000;
  const timer = setTimeout(run, delay);
  timer.unref?.();
  retryTimers.set(name, { timer, failures });
  console.log(`[background] ${name}: source unreachable, trying again in ${delay / 60_000} min`);
}

/** Syncs every game's catalog: new, failed and stale sets, newest first. */
export function requestCatalogSync(): void {
  for (const adapter of catalogAdapters()) {
    const name = `catalog:${adapter.game}`;
    requestRun(name, async () => {
      const settings = await getSettings();
      const result = await runCatalogSync(adapter, {
        refreshAfterMs: settings.catalogRefreshDays * 86_400_000,
        log: (line) => console.log(`[${name}] ${line}`),
      });
      if (result.run.status === "locked") return;
      scheduleRetry(
        name,
        result.run.discoveryError !== undefined || result.run.status === "halted",
        requestCatalogSync,
      );
    });
  }
}

let providerCache: { key: string; providers: Record<PriceProviderId, PriceProvider> } | null = null;

/**
 * Price providers with the current credentials and settings. Reused while
 * those don't change, so provider-side caches (CardTrader's expansion list,
 * eBay's token, the shared TCGdex fetch) survive between runs.
 */
export async function priceProviders(): Promise<{
  settings: AppSettings;
  providers: Record<PriceProviderId, PriceProvider>;
}> {
  const [settings, secrets] = await Promise.all([getSettings(), readSecrets()]);
  const credentials = {
    cardtraderToken: secrets.cardtraderToken,
    ebayClientId: secrets.ebayClientId,
    ebayClientSecret: secrets.ebayClientSecret,
    ebayMarketplaceId: settings.ebay.marketplaceId,
    ebayEnvironment: settings.ebay.environment,
  };
  const key = JSON.stringify(credentials);
  if (providerCache?.key !== key)
    providerCache = { key, providers: createPriceProviders(credentials) };
  return { settings, providers: providerCache.providers };
}

let valuationTimer: ReturnType<typeof setTimeout> | null = null;

/** Recomputes values + today's portfolio snapshot once price runs settle (debounced). */
export function scheduleValuations(delayMs = 30_000): void {
  if (valuationTimer) clearTimeout(valuationTimer);
  valuationTimer = setTimeout(() => {
    valuationTimer = null;
    requestRun("valuations", async () => {
      await computeValuations();
      await snapshotPortfolio();
    });
  }, delayMs);
  valuationTimer.unref?.();
}

/**
 * Refreshes prices for every game x enabled provider, each provider as its
 * own run (own lock, own throttle): one failing or rate-limited provider
 * never holds up the others. Only stale collection / recently viewed /
 * requested cards are priced — never the whole catalog.
 */
export function requestPriceRefresh(only?: PriceProviderId[]): void {
  for (const { game } of catalogAdapters()) {
    for (const id of only ?? PRICE_PROVIDERS) {
      const name = `price:${id}:${game}`;
      requestRun(name, async () => {
        const { settings, providers } = await priceProviders();
        if (!settings.providers[id].enabled) return;
        const result = await runPriceRefresh(providers[id], game, {
          refreshAfterMs: settings.priceRefreshHours * 3_600_000,
          log: (line) => console.log(`[${name}] ${line}`),
        });
        if (result.succeeded.length > 0) scheduleValuations();
      });
    }
  }
}

/** Daily ECB exchange rates (skipped when today's are already stored). */
export function requestFxRefresh(): void {
  requestRun("fx", () => refreshFxRates({ log: (line) => console.log(`[fx] ${line}`) }));
}

/**
 * Called once from instrumentation.ts. Waits a little so the first page
 * render never competes with the first sync for the DB or the network.
 */
export function startBackgroundJobs(delayMs = 10_000): void {
  if (state.__tcgVaultStarted) return;
  state.__tcgVaultStarted = true;
  const timer = setTimeout(() => {
    requestCatalogSync();
    requestFxRefresh();
    requestPriceRefresh();
    // Today's portfolio point exists even when no price changed.
    scheduleValuations(5_000);
  }, delayMs);
  timer.unref?.();
}
