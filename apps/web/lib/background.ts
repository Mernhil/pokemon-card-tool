import {
  cleanupPriceQueue,
  enqueueCatalogPrices,
  runBackup,
  runBackupIfDue,
  computeValuations,
  getSettings,
  readSecrets,
  refreshFxRates,
  runCatalogSync,
  runPriceRefresh,
  runnableProviders,
  snapshotPortfolio,
  type AppSettings,
} from "@tcg-vault/db";
import { PRICE_PROVIDERS, TCGDEX_LANGUAGES, type PriceProviderId } from "@tcg-vault/shared";
import {
  OptcgAdapter,
  TCGCSV_SET_PREFIXES,
  TcgcsvJapanFallback,
  TcgcsvPromoAdapter,
  withExtraSets,
  withTcgcsvJapanFallback,
  PokemonTcgIoImageFallback,
  TcgdexPokemonAdapter,
  YgoprodeckAdapter,
  createPriceProviders,
  withImageFallback,
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

// Cards TCGdex has no scan for at all (e.g. some 30th Anniversary Classic
// Collection reprints) get a second chance from pokemontcg.io before falling
// back to the "no image yet" placeholder.
const pokemonImageFallback = new PokemonTcgIoImageFallback();

/** A language's catalog that lists no sets while that language is switched off in Settings. */
function whenLanguageEnabled(adapter: CatalogSourceAdapter, code: string): CatalogSourceAdapter {
  const on = async () => (await getSettings()).catalogLanguages.includes(code);
  const gated: CatalogSourceAdapter = Object.create(adapter);
  gated.listSets = async () => ((await on()) ? adapter.listSets() : []);
  gated.listSetSummaries = async () => ((await on()) ? adapter.listSetSummaries() : []);
  return gated;
}

/**
 * Pokémon: English TCGdex (with a pokemontcg.io image fallback), the tcgcsv promos TCGdex lacks,
 * and one catalog per other TCGdex language (set codes prefixed with the language). Japanese
 * cards TCGdex has no scan or TCGplayer price for get them from tcgcsv's Japanese catalog.
 */
function pokemonAdapter(): CatalogSourceAdapter {
  const japanFallback = new TcgcsvJapanFallback();
  let adapter = withExtraSets(
    withImageFallback(new TcgdexPokemonAdapter(), pokemonImageFallback),
    new TcgcsvPromoAdapter(),
    TCGCSV_SET_PREFIXES,
  );
  for (const lang of TCGDEX_LANGUAGES) {
    let catalog: CatalogSourceAdapter = new TcgdexPokemonAdapter(undefined, {
      language: lang.tcgdex,
      codePrefix: lang.prefix,
    });
    if (lang.code === "ja") catalog = withTcgcsvJapanFallback(catalog, japanFallback, lang.prefix);
    adapter = withExtraSets(adapter, whenLanguageEnabled(catalog, lang.code), [lang.prefix]);
  }
  return adapter;
}

const CATALOG_ADAPTERS: Array<() => CatalogSourceAdapter> = [
  pokemonAdapter,
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

/** Providers that will actually run for a game right now (enabled, configured, supports it). */
export async function runnablePriceProviders(game: string): Promise<PriceProviderId[]> {
  const { settings, providers } = await priceProviders();
  return runnableProviders(game, providers, settings.providers);
}

/** Drops price-queue rows that can never run (see cleanupPriceQueue). */
export async function cleanupOrphanedPriceRows(): Promise<void> {
  const { settings, providers } = await priceProviders();
  const removed = await cleanupPriceQueue((game) =>
    runnableProviders(game, providers, settings.providers),
  );
  if (removed > 0) console.log(`[background] cleaned up ${removed} orphaned price queue rows`);
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

/** Backs up the database if enabled and the newest copy is over a day old (or forced). */
export function requestBackup(force = false): void {
  requestRun("backup", async () => {
    if (force) await runBackup();
    else await runBackupIfDue();
  });
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
          priceLanguage: settings.priceLanguage,
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
  void cleanupOrphanedPriceRows().catch(() => {});
  const timer = setTimeout(() => {
    requestCatalogSync();
    requestFxRefresh();
    requestPriceRefresh();
    requestBackup();
    // Today's portfolio point exists even when no price changed.
    scheduleValuations(5_000);
  }, delayMs);
  timer.unref?.();
}

/**
 * Prices every catalog card of a game with one provider, not just the collection: queues the
 * lot at low priority, then works through it in one run with no per-run item cap. The job's
 * lock keeps it from overlapping the regular refresh.
 */
export async function requestCatalogPriceSync(id: PriceProviderId, game: string): Promise<number> {
  const queued = await enqueueCatalogPrices(id, game);
  requestRun(`price-full:${id}:${game}`, async () => {
    const { settings, providers } = await priceProviders();
    if (!settings.providers[id].enabled) return;
    const name = `price-full:${id}:${game}`;
    const result = await runPriceRefresh(providers[id], game, {
      refreshAfterMs: settings.priceRefreshHours * 3_600_000,
      priceLanguage: settings.priceLanguage,
      maxItems: Number.MAX_SAFE_INTEGER,
      skipDiscovery: true,
      log: (line) => console.log(`[${name}] ${line}`),
    });
    if (result.succeeded.length > 0) scheduleValuations();
  });
  return queued;
}
