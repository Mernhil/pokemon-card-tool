import {
  DEFAULT_PRICE_LANGUAGE,
  PRICE_PROVIDERS,
  TCGDEX_LANGUAGES,
  type MappingStatus,
  type PriceProviderId,
} from "@tcg-vault/shared";
import { LANGUAGE_AWARE_PROVIDERS } from "@tcg-vault/pricing";
import type { PriceProvider, PricedCard, ResolvedMapping } from "@tcg-vault/sources";
import { prisma } from "./client";
import { NonRetryableError, errorMessage, retryAfterMs } from "./jobs/backoff";
import {
  enqueueItems,
  runJob,
  upsertItems,
  type JobItem,
  type JobRunOptions,
  type JobRunSummary,
} from "./jobs/runner";
import { recordObservations } from "./prices";

/**
 * Background price refresh: one job per provider ("price:<provider>"), one
 * SyncState item per variant, on the same runner as the catalog sync — so
 * it's resumable, lock-guarded, retried with backoff, and one provider
 * failing (or being rate-limited) never holds up the others, each of which
 * runs on its own.
 *
 * What gets priced — never the whole catalog:
 *   400  cards the user opened with stale prices (enqueued by the card page)
 *   300  cards in the collection, every `priceRefreshHours` (24 h)
 *   200  cards viewed in the last 14 days, same cadence
 * Everything else only when someone opens it. Pokémon TCG Pocket sets are
 * never priced: digital-only cards have no market.
 */

export const PRICE_PRIORITY = {
  onDemand: 400,
  collection: 300,
  wishlistTarget: 250,
  recentlyViewed: 200,
} as const;
const RECENTLY_VIEWED_DAYS = 14;
/** Automatic matches are re-checked this often (manual ones never). */
const REMATCH_AFTER_MS = 30 * 86_400_000;
const RETRY_UNMATCHED_AFTER_MS = 7 * 86_400_000;

export function priceJob(provider: string): string {
  return `price:${provider}`;
}

/**
 * Queue item key of a price refresh: the variant id, which means "in the price
 * language from Settings", or `<variant id>@<language>` for one language
 * looked up on demand (a card page asking for another language; only providers
 * that can look a language up, i.e. eBay, get such items).
 */
export function priceItemKey(variantId: string, language?: string | null): string {
  return language ? `${variantId}@${language}` : variantId;
}

export function parsePriceItemKey(key: string): { variantId: string; language: string | null } {
  const at = key.indexOf("@");
  return at < 0
    ? { variantId: key, language: null }
    : { variantId: key.slice(0, at), language: key.slice(at + 1) || null };
}

/** Our variant, in the shape providers need. null if it no longer exists. */
export async function loadPricedCard(
  variantId: string,
  priceLanguage?: string,
): Promise<PricedCard | null> {
  const v = await prisma.printVariant.findUnique({
    where: { id: variantId },
    include: {
      printing: {
        include: {
          card: true,
          set: { include: { game: true } },
          variants: { select: { finish: true } },
          externalRefs: true,
        },
      },
      providerMaps: { where: { status: "matched" } },
    },
  });
  if (!v) return null;
  const externalIds: Record<string, string> = {};
  for (const ref of v.printing.externalRefs) externalIds[ref.source] = ref.externalId;
  // Our own earlier match isn't evidence for the next one: a wrong CardTrader blueprint would
  // otherwise keep confirming itself. Links the catalog made (TCGdex) and manual ones are.
  for (const m of v.providerMaps)
    if (m.externalId && (m.provider !== "cardtrader" || m.manualOverride))
      externalIds[m.provider] = m.externalId;
  const english = await englishCounterpart(v.printing.set, v.printing.collectorNumber, externalIds);
  return {
    variantId: v.id,
    game: v.printing.set.game.slug,
    cardName: v.printing.card.name,
    cardNameAlt: english?.cardName ?? null,
    setCode: v.printing.set.code,
    setName: v.printing.set.name,
    setNameAlt: english?.setName ?? null,
    collectorNumber: v.printing.collectorNumber,
    printedTotal: v.printing.set.printedTotal,
    finish: v.finish,
    edition: v.edition,
    printingFinishes: [...new Set(v.printing.variants.map((x) => x.finish))],
    languageCode: v.languageCode,
    priceLanguage: priceLanguage ?? v.languageCode,
    externalIds,
  };
}

/**
 * A card from another language's catalog ("it-30th-c"): the same card in the English
 * catalog, whose card and set names marketplaces like CardTrader know it by. Found by the
 * TCGdex id the languages share ("30th-c-001"), which still works when the English set was
 * merged into another one (the Classic Collection lives inside "30th"); else by set code
 * and collector number. Its Cardmarket link fills in when ours has none.
 */
async function englishCounterpart(
  set: { code: string; gameId: number },
  collectorNumber: string,
  externalIds: Record<string, string>,
): Promise<{ cardName: string; setName: string } | null> {
  const language = TCGDEX_LANGUAGES.find((l) => set.code.startsWith(l.prefix));
  if (!language) return null;
  const tcgdexId = externalIds[`tcgdex-pokemon-${language.tcgdex}`];
  const select = {
    card: { select: { name: true } },
    set: { select: { name: true } },
    variants: {
      select: {
        providerMaps: {
          where: { provider: "cardmarket", status: "matched" },
          select: { externalId: true },
        },
      },
    },
  } as const;
  const printing =
    (tcgdexId
      ? (
          await prisma.externalRef.findUnique({
            where: { source_externalId: { source: "tcgdex-pokemon", externalId: tcgdexId } },
            select: { printing: { select } },
          })
        )?.printing
      : null) ??
    (await prisma.printing.findFirst({
      where: {
        collectorNumber,
        set: { gameId: set.gameId, code: set.code.slice(language.prefix.length) },
      },
      select,
    }));
  if (!printing) return null;
  if (!externalIds.cardmarket) {
    const cm = printing.variants.flatMap((x) => x.providerMaps).find((m) => m.externalId);
    if (cm?.externalId) externalIds.cardmarket = cm.externalId;
  }
  return { cardName: printing.card.name, setName: printing.set.name };
}

async function markProvider(provider: string, err: unknown | null): Promise<void> {
  const now = new Date();
  const wait = err ? retryAfterMs(err) : undefined;
  const data = err
    ? {
        lastErrorAt: now,
        lastError: errorMessage(err).slice(0, 500),
        ...(wait !== undefined ? { rateLimitedUntil: new Date(now.getTime() + wait) } : {}),
      }
    : { lastSuccessAt: now, rateLimitedUntil: null };
  await prisma.providerStatus.upsert({
    where: { provider },
    update: data,
    create: { provider, ...data },
  });
}

/** The stored mapping, (re)resolved when missing or due for a re-check. */
async function mappingFor(
  provider: PriceProvider,
  card: PricedCard,
  now: Date,
): Promise<ResolvedMapping> {
  const row = await prisma.providerMapping.findUnique({
    where: { variantId_provider: { variantId: card.variantId, provider: provider.id } },
  });
  const age = row ? now.getTime() - row.resolvedAt.getTime() : Infinity;
  const due =
    !row ||
    (!row.manualOverride &&
      (age > REMATCH_AFTER_MS || (row.status !== "matched" && age > RETRY_UNMATCHED_AFTER_MS)));
  if (row && !due) {
    return {
      externalId: row.externalId,
      query: row.query,
      url: row.url,
      confidence: row.confidence,
      status: row.status as MappingStatus,
      notes: row.notes,
    };
  }
  const resolved = await provider.resolveMapping(card);
  if (!resolved) throw new NonRetryableError(`${provider.label} is not configured`);
  const data = { ...resolved, resolvedAt: now };
  await prisma.providerMapping.upsert({
    where: { variantId_provider: { variantId: card.variantId, provider: provider.id } },
    update: data,
    create: { variantId: card.variantId, provider: provider.id, ...data },
  });
  return resolved;
}

/** Refreshes one variant's prices from one provider. Returns observations written. */
export async function refreshVariantPrices(
  provider: PriceProvider,
  itemKey: string,
  now = new Date(),
  defaultLanguage: string = DEFAULT_PRICE_LANGUAGE,
): Promise<number> {
  const { variantId, language } = parsePriceItemKey(itemKey);
  const card = await loadPricedCard(variantId, language ?? defaultLanguage);
  if (!card) throw new NonRetryableError("this card no longer exists in the catalog");
  try {
    const mapping = await mappingFor(provider, card, now);
    // Nothing to price: not an error (the card page says "No match found").
    // Only TCGdex relays edition-specific prices; listing searches can't tell a 1st Edition apart.
    const editionUnpriced =
      (card.edition ?? "UNLIMITED") !== "UNLIMITED" &&
      provider.id !== "cardmarket" &&
      provider.id !== "tcgplayer";
    const written =
      mapping.status === "not_found" || editionUnpriced
        ? 0
        : await recordObservations(
            variantId,
            provider.id,
            await provider.fetchPrices(card, mapping),
          );
    await markProvider(provider.id, null);
    return written;
  } catch (err) {
    await markProvider(provider.id, err);
    throw err;
  }
}

/** What should be kept fresh for a game: collection first, then recently viewed. */
export async function priceRefreshItems(game: string, now = new Date()): Promise<JobItem[]> {
  const [owned, viewed] = await Promise.all([
    prisma.printVariant.findMany({
      where: {
        collection: { some: {} },
        printing: { set: { game: { slug: game }, category: { not: "pocket" } } },
      },
      select: {
        id: true,
        printing: { select: { card: { select: { name: true } }, collectorNumber: true } },
      },
    }),
    prisma.cardView.findMany({
      where: { lastViewedAt: { gte: new Date(now.getTime() - RECENTLY_VIEWED_DAYS * 86_400_000) } },
      select: { printingId: true },
    }),
  ]);
  const viewedVariants = viewed.length
    ? await prisma.printVariant.findMany({
        where: {
          printingId: { in: viewed.map((v) => v.printingId) },
          printing: { set: { game: { slug: game }, category: { not: "pocket" } } },
        },
        select: {
          id: true,
          printing: { select: { card: { select: { name: true } }, collectorNumber: true } },
        },
      })
    : [];
  // Wishlist cards with a target price are watched like the collection (the deal finder).
  const watched = await prisma.printVariant.findMany({
    where: {
      edition: "UNLIMITED",
      printing: {
        wishlist: { is: { targetEur: { not: null } } },
        set: { game: { slug: game }, category: { not: "pocket" } },
      },
    },
    select: {
      id: true,
      printing: { select: { card: { select: { name: true } }, collectorNumber: true } },
    },
  });
  const items = new Map<string, JobItem>();
  const label = (v: (typeof owned)[number]) =>
    `${v.printing.card.name} ${v.printing.collectorNumber}`;
  for (const v of viewedVariants)
    items.set(v.id, { key: v.id, label: label(v), priority: PRICE_PRIORITY.recentlyViewed });
  for (const v of watched)
    items.set(v.id, { key: v.id, label: label(v), priority: PRICE_PRIORITY.wishlistTarget });
  for (const v of owned)
    items.set(v.id, { key: v.id, label: label(v), priority: PRICE_PRIORITY.collection });
  return [...items.values()];
}

/**
 * Drops finished price items that are neither owned nor recently viewed any
 * more, so they stop being refreshed (their price history stays).
 */
async function pruneItems(job: string, game: string, keep: Set<string>): Promise<void> {
  const rows = await prisma.syncState.findMany({
    where: { job, game, status: { in: ["done", "failed"] } },
    select: { id: true, itemKey: true },
  });
  const drop = rows.filter((r) => !keep.has(r.itemKey)).map((r) => r.id);
  for (let i = 0; i < drop.length; i += 500) {
    await prisma.syncState.deleteMany({ where: { id: { in: drop.slice(i, i + 500) } } });
  }
}

export interface PriceRefreshOptions extends JobRunOptions {
  /** How often collection/viewed cards are refreshed. Default 24 h. */
  refreshAfterMs?: number;
  /** The price language from Settings; language-aware providers (eBay) fetch only this one. */
  priceLanguage?: string;
}

/** One provider's refresh run for one game. `skipped` when the provider can't run. */
export async function runPriceRefresh(
  provider: PriceProvider,
  game: string,
  options: PriceRefreshOptions = {},
): Promise<JobRunSummary & { skipped?: string }> {
  if (!provider.capabilities.games.includes(game)) {
    return { status: "completed", succeeded: [], failed: [], skipped: "game not supported" };
  }
  if (!provider.isConfigured()) {
    return { status: "completed", succeeded: [], failed: [], skipped: "not configured" };
  }
  const job = priceJob(provider.id);
  return runJob(
    {
      job,
      game,
      discover: async () => {
        const items = await priceRefreshItems(game, options.now?.());
        await pruneItems(job, game, new Set(items.map((i) => i.key)));
        return items;
      },
      process: async (item) => {
        await refreshVariantPrices(
          provider,
          item.key,
          options.now?.(),
          options.priceLanguage ?? DEFAULT_PRICE_LANGUAGE,
        );
      },
    },
    {
      // Providers throttle their own requests; one card at a time per provider.
      concurrency: 1,
      delayMs: 0,
      refreshAfterMs: 24 * 3_600_000,
      // eBay's Browse API allows 5,000 calls/day: stay far below it per (hourly) run.
      maxItems: provider.id === "ebay" ? 150 : 1_000,
      ...options,
    },
  );
}

/**
 * The card page's "these prices are stale": queues the variants for every
 * given provider at the highest priority, unless they were refreshed within
 * `staleAfterMs` or are already queued. Returns whether anything was queued.
 */
export async function enqueueStalePrices(
  variantIds: string[],
  providers: PriceProviderId[],
  game: string,
  staleAfterMs: number,
  now = new Date(),
): Promise<boolean> {
  let queued = false;
  for (const provider of providers) {
    const job = priceJob(provider);
    const states = await prisma.syncState.findMany({
      where: { job, game, itemKey: { in: variantIds } },
    });
    const byKey = new Map(states.map((s) => [s.itemKey, s]));
    const stale = variantIds.filter((id) => {
      const s = byKey.get(id);
      if (!s) return true;
      if (s.status === "pending" || s.status === "syncing") return false;
      // Don't hammer a failing provider from page views: wait an hour after a failure.
      if (
        s.status === "failed" &&
        s.lastAttemptAt &&
        now.getTime() - s.lastAttemptAt.getTime() < 3_600_000
      ) {
        return false;
      }
      return !s.lastSyncedAt || now.getTime() - s.lastSyncedAt.getTime() > staleAfterMs;
    });
    if (stale.length > 0) {
      await enqueueItems(
        job,
        game,
        stale.map((key) => ({ key })),
        PRICE_PRIORITY.onDemand,
      );
      queued = true;
    }
  }
  return queued;
}

/**
 * Providers that will actually run for a game right now: turned on in
 * Settings, configured (API key present where one is needed) and supporting
 * the game. The single answer used both to queue work and to tell whether
 * "something is updating" — queueing for a provider that can't run leaves
 * rows `pending` forever.
 */
export function runnableProviders(
  game: string,
  providers: Record<PriceProviderId, PriceProvider>,
  enabled: Record<PriceProviderId, { enabled: boolean }>,
): PriceProviderId[] {
  return PRICE_PROVIDERS.filter((id) => {
    const p = providers[id];
    return enabled[id].enabled && p.isConfigured() && p.capabilities.games.includes(game);
  });
}

/** Queued/running rows older than this are dead (a crashed run), not "updating". */
export const STALE_UPDATING_MS = 10 * 60_000;

/**
 * Removes queue rows that can never run (`pending`/`syncing` for providers
 * that aren't runnable for the game) and re-queues `syncing` rows left
 * behind by a dead run. Called at startup and on every enqueue, so no data
 * migration is needed. Returns how many rows it touched.
 */
export async function cleanupPriceQueue(
  runnable: (game: string) => PriceProviderId[],
  now = new Date(),
): Promise<number> {
  const games = await prisma.syncState.findMany({
    where: { job: { startsWith: "price:" } },
    distinct: ["game"],
    select: { game: true },
  });
  let touched = 0;
  const cutoff = new Date(now.getTime() - STALE_UPDATING_MS);
  for (const { game } of games) {
    const jobs = runnable(game).map(priceJob);
    const dead = await prisma.syncState.deleteMany({
      where: {
        game,
        job: { startsWith: "price:", notIn: jobs },
        status: { in: ["pending", "syncing"] },
      },
    });
    const stuck = await prisma.syncState.updateMany({
      where: { game, job: { in: jobs }, status: "syncing", updatedAt: { lt: cutoff } },
      data: { status: "pending" },
    });
    touched += dead.count + stuck.count;
  }
  return touched;
}

/**
 * "Refresh prices" button: queue these variants for the given providers now,
 * stale or not. `providers` defaults to all of them (CLI / tests); the app
 * passes {@link runnableProviders}.
 */
export async function enqueuePriceRefresh(
  variantIds: string[],
  game: string,
  providers: readonly PriceProviderId[] = PRICE_PROVIDERS,
): Promise<void> {
  for (const provider of providers) {
    await enqueueItems(
      priceJob(provider),
      game,
      variantIds.map((key) => ({ key })),
      PRICE_PRIORITY.onDemand,
    );
  }
}

/**
 * A card page asked for prices in a language that has no data yet: queues an
 * on-demand lookup for it with every given provider that can look a language
 * up (eBay). CardTrader already stores every listing language from its single
 * fetch, and Cardmarket/TCGplayer can't split by language, so they're skipped.
 * Returns whether anything was queued.
 */
export async function enqueueLanguagePrices(
  variantIds: string[],
  game: string,
  language: string,
  providers: readonly PriceProviderId[],
  { freshMs = 24 * 3_600_000, now = new Date() }: { freshMs?: number; now?: Date } = {},
): Promise<boolean> {
  const lookups = providers.filter((p) => LANGUAGE_AWARE_PROVIDERS.has(p) && p === "ebay");
  let queued = false;
  for (const provider of lookups) {
    const job = priceJob(provider);
    const keys = variantIds.map((id) => priceItemKey(id, language));
    const states = await prisma.syncState.findMany({ where: { job, game, itemKey: { in: keys } } });
    const byKey = new Map(states.map((s) => [s.itemKey, s]));
    // Opening the page must not re-query eBay every time: skip what is queued, was looked up
    // within `freshMs`, or failed within the last hour (the same budget rules as stale prices).
    const due = keys.filter((key) => {
      const s = byKey.get(key);
      if (!s) return true;
      if (s.status === "pending" || s.status === "syncing") return false;
      if (
        s.status === "failed" &&
        s.lastAttemptAt &&
        now.getTime() - s.lastAttemptAt.getTime() < 3_600_000
      )
        return false;
      return !s.lastSyncedAt || now.getTime() - s.lastSyncedAt.getTime() > freshMs;
    });
    if (due.length === 0) continue;
    await enqueueItems(
      job,
      game,
      due.map((key) => ({ key })),
      PRICE_PRIORITY.onDemand,
    );
    queued = true;
  }
  return queued;
}

/**
 * Whether any of these variants has a price refresh queued or running (for
 * "Updating…"). Only counts the given (runnable) providers and rows touched
 * in the last {@link STALE_UPDATING_MS}, so an orphaned row never shows a
 * phantom "Updating…".
 */
export async function pricesUpdating(
  variantIds: string[],
  opts: { providers?: readonly PriceProviderId[]; game?: string; now?: Date } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const n = await prisma.syncState.count({
    where: {
      job: opts.providers ? { in: opts.providers.map(priceJob) } : { startsWith: "price:" },
      ...(opts.game ? { game: opts.game } : {}),
      OR: variantIds.flatMap((id) => [{ itemKey: id }, { itemKey: { startsWith: `${id}@` } }]),
      status: { in: ["pending", "syncing"] },
      updatedAt: { gte: new Date(now.getTime() - STALE_UPDATING_MS) },
    },
  });
  return n > 0;
}

/** Remembers that a card page was opened (drives "recently viewed" refreshes). */
export async function recordCardView(printingId: string, now = new Date()): Promise<void> {
  await prisma.cardView.upsert({
    where: { printingId },
    update: { lastViewedAt: now, viewCount: { increment: 1 } },
    create: { printingId, lastViewedAt: now },
  });
}

/** Below every automatic priority: a whole-catalog pass never jumps ahead of the collection. */
const CATALOG_PRICE_PRIORITY = 100;

/**
 * "Price the whole catalog": queues every priced variant of a game (Pokémon TCG Pocket
 * excluded) for one provider, and re-queues rows that were already done or failed so the
 * pass is a full check. Items already queued for the collection keep their priority.
 * Returns how many variants are queued.
 */
export async function enqueueCatalogPrices(provider: PriceProviderId, game: string): Promise<number> {
  const job = priceJob(provider);
  const variants = await prisma.printVariant.findMany({
    where: { printing: { set: { game: { slug: game }, category: { not: "pocket" } } } },
    select: {
      id: true,
      printing: { select: { card: { select: { name: true } }, collectorNumber: true } },
    },
  });
  const existing = await prisma.syncState.findMany({
    where: { job, game },
    select: { itemKey: true, priority: true },
  });
  const keep = new Set(existing.filter((r) => r.priority > CATALOG_PRICE_PRIORITY).map((r) => r.itemKey));
  await upsertItems(
    job,
    game,
    variants
      .filter((v) => !keep.has(v.id))
      .map((v) => ({
        key: v.id,
        label: `${v.printing.card.name} ${v.printing.collectorNumber}`,
        priority: CATALOG_PRICE_PRIORITY,
      })),
  );
  await prisma.syncState.updateMany({
    where: { job, game, status: { in: ["done", "failed", "unavailable"] } },
    data: { status: "pending" },
  });
  return variants.length;
}

/** Progress of a provider's price queue for a game. */
export async function priceQueueProgress(
  provider: PriceProviderId,
  game: string,
): Promise<{ pending: number; done: number; failed: number; unavailable: number }> {
  const rows = await prisma.syncState.groupBy({
    by: ["status"],
    where: { job: priceJob(provider), game },
    _count: true,
  });
  const n = (...statuses: string[]) =>
    rows.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + r._count, 0);
  return {
    pending: n("pending", "syncing"),
    done: n("done"),
    failed: n("failed"),
    unavailable: n("unavailable"),
  };
}
