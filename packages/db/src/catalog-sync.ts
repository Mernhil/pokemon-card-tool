import type { Prisma } from "@prisma/client";
import {
  canonicalKeyFor,
  classifySet,
  hasFile,
  mergeTarget,
  subsetFor,
  mediaUrl,
  putFile,
  remoteImageKey,
} from "@tcg-vault/shared";
import type { CatalogSourceAdapter, SourcePrinting, SourceSet } from "@tcg-vault/sources";
import { prisma } from "./client";
import { SourceUnavailableError } from "./jobs/backoff";
import { onJobEvent } from "./jobs/events";
import {
  enqueueItems,
  jobStateCounts,
  runJob,
  type ClaimedItem,
  type JobRunOptions,
  type JobRunSummary,
} from "./jobs/runner";
import { dexIdsFromAttributes, setCardDex } from "./dex";
import { recordPrices } from "./prices";
import { computeValuations, snapshotPortfolio } from "./valuations";

/**
 * Background catalog sync: Game/Set/Rarity/Artist/Card/Printing/PrintVariant
 * (+ the market prices the source bundles with each card), one SyncState item
 * per set, run through the shared job runner (src/jobs/runner.ts).
 *
 * Card *metadata* only: images are never downloaded here. Each printing gets
 * its remote image URLs plus a virtual `remote/<printingId>` imageKey, and
 * the media route fetches + caches the scan the first time it's viewed
 * (packages/db/src/image-cache.ts).
 *
 * Nothing here is Pokémon-specific: the game, language and data all come
 * from the {@link CatalogSourceAdapter}. Driven by the app's background
 * scheduler, the Sync page and the `pnpm db:sync-catalog` CLI.
 */

export const CATALOG_JOB = "catalog";

/** Priority for sets the user explicitly asked for — ahead of everything discovered. */
export const MANUAL_PRIORITY = 1_000_000;

export interface Counters {
  setsProcessed: number;
  cardsCreated: number;
  cardsUpdated: number;
  printingsCreated: number;
  printingsUpdated: number;
  variantsCreated: number;
  variantsPruned: number;
  variantsKeptStale: number;
  /** Cards the source has no image for yet; retried on every later sync. */
  imagesMissing: string[];
  priceObservations: number;
  errors: Array<{ setCode: string; collectorNumber?: string; cardName?: string; message: string }>;
}

function emptyCounters(): Counters {
  return {
    setsProcessed: 0,
    cardsCreated: 0,
    cardsUpdated: 0,
    printingsCreated: 0,
    printingsUpdated: 0,
    variantsCreated: 0,
    variantsPruned: 0,
    variantsKeptStale: 0,
    imagesMissing: [],
    priceObservations: 0,
    errors: [],
  };
}

function addCounters(into: Counters, from: Counters): void {
  for (const key of Object.keys(into) as Array<keyof Counters>) {
    const a = into[key];
    const b = from[key];
    if (typeof a === "number" && typeof b === "number") (into[key] as number) = a + b;
    else if (Array.isArray(a) && Array.isArray(b)) (a as unknown[]).push(...b);
  }
}

/** Pulls plain gameplay/rules text out of a SourcePrinting's free-form attributes, for canonicalKeyFor. */
function deriveRulesText(attributes: Record<string, unknown>): string | undefined {
  const parts: string[] = [];

  if (typeof attributes.effect === "string") parts.push(attributes.effect);

  for (const key of ["abilities", "attacks"] as const) {
    const list = attributes[key];
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { effect?: unknown }).effect === "string"
        ) {
          parts.push((entry as { effect: string }).effect);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** Numeric part of a collector number/local id, for Printing.sortNumber ordering. */
function sortNumberFor(collectorNumber: string): number {
  const match = collectorNumber.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

type Tx = Prisma.TransactionClient;

async function ensureGameAndLanguage(adapter: CatalogSourceAdapter) {
  // ensureBaseData() creates the known games/languages on startup; this is
  // for a CLI run against a fresh DB, or a new adapter's language.
  const game = await prisma.game.upsert({
    where: { slug: adapter.game },
    update: {},
    create: { slug: adapter.game, name: adapter.game },
  });
  await prisma.language.upsert({
    where: { code: adapter.languageCode },
    update: {},
    create: { code: adapter.languageCode, name: adapter.languageCode },
  });
  return game;
}

/**
 * Keeps a copy of a set's logo/symbol in local media so pages don't load
 * them from the internet (they work offline and don't leak requests).
 * Returns the local /media URL, or the remote URL if it couldn't be fetched.
 * Best-effort and outside the set's transaction: a logo never fails a set.
 */
async function localAsset(remote: string | undefined, key: string): Promise<string | null> {
  if (!remote) return null;
  // Keep the file's real extension (YGOPRODeck's pack art is a .jpg).
  const ext = remote.match(/\.(jpe?g|webp|png)(?:\?|$)/i)?.[1]?.toLowerCase();
  if (ext && ext !== "png") key = key.replace(/\.png$/, `.${ext === "jpeg" ? "jpg" : ext}`);
  if (await hasFile(key)) return mediaUrl(key);
  try {
    const res = await fetch(remote);
    if (!res.ok) return remote;
    await putFile(key, Buffer.from(await res.arrayBuffer()));
    return mediaUrl(key);
  } catch {
    return remote;
  }
}

async function upsertCard(tx: Tx, gameId: number, printing: SourcePrinting, counters: Counters) {
  const rulesText = deriveRulesText(printing.attributes);
  const canonicalKey = canonicalKeyFor(printing.cardName, rulesText);
  const data = {
    name: printing.cardName,
    cardType: printing.cardType,
    subtypes: JSON.stringify(printing.subtypes),
    rulesText: rulesText ?? null,
    attributes: JSON.stringify(printing.attributes),
  };

  const existing = await tx.card.findUnique({
    where: { gameId_canonicalKey: { gameId, canonicalKey } },
  });
  let card;
  if (existing) {
    counters.cardsUpdated++;
    card = await tx.card.update({ where: { id: existing.id }, data });
  } else {
    counters.cardsCreated++;
    card = await tx.card.create({ data: { gameId, canonicalKey, ...data } });
  }
  // Pokédex ids, normalized for indexed "all cards of this Pokémon" lookups.
  const dexIds = dexIdsFromAttributes(printing.attributes);
  if (dexIds.length > 0 || existing) await setCardDex(tx, card.id, dexIds);
  return card;
}

/**
 * One PrintVariant per finish the source reports (NON_FOIL / HOLO /
 * REVERSE_HOLO), falling back to NON_FOIL alone when it reports none.
 *
 * When the source did report finishes, also prunes this printing's variants
 * for finishes it no longer reports (e.g. the blanket NON_FOIL rows an
 * earlier sync wrote before finish data was read) — but only when nothing
 * references them, so a variant the user owns, has in a binder, or has price
 * history for is never deleted.
 */
async function syncVariants(
  tx: Tx,
  printingId: string,
  languageCode: string,
  printing: SourcePrinting,
  counters: Counters,
) {
  const reported = printing.finishes ?? [];
  const finishes = reported.length > 0 ? reported : ["NON_FOIL"];

  for (const finish of finishes) {
    const key = { printingId, finish, edition: "UNLIMITED", languageCode };
    const existing = await tx.printVariant.findUnique({
      where: { printingId_finish_edition_languageCode: key },
    });
    if (!existing) {
      await tx.printVariant.create({ data: key });
      counters.variantsCreated++;
    }
  }

  // Nothing reported means nothing to prune against — don't treat "unknown"
  // as "only NON_FOIL exists".
  if (reported.length === 0) return;

  const stale = await tx.printVariant.findMany({
    where: {
      printingId,
      edition: "UNLIMITED",
      languageCode,
      finish: { notIn: finishes },
    },
    include: {
      _count: {
        select: {
          collection: true,
          priceObs: true,
          sales: true,
          valuations: true,
          mappings: true,
        },
      },
    },
  });

  for (const variant of stale) {
    const referenced =
      Object.values(variant._count).some((n) => n > 0) ||
      (await tx.binderSlot.count({ where: { placeholderVariantId: variant.id } })) > 0;
    if (referenced) {
      counters.variantsKeptStale++;
      continue;
    }
    await tx.printVariant.delete({ where: { id: variant.id } });
    counters.variantsPruned++;
  }
}

/**
 * The image a printing should show: a real local file from an older sync is
 * kept as is (and never evicted); otherwise the virtual remote key the media
 * route resolves through the image cache, when the source has an image.
 */
async function imageKeyFor(
  existingKey: string | null | undefined,
  printingId: string,
  hasRemote: boolean,
): Promise<string | null> {
  // `hasRemote` is also true for a printing with a user-supplied image (see the caller).
  if (existingKey && !existingKey.startsWith("remote/") && (await hasFile(existingKey))) {
    return existingKey;
  }
  return hasRemote ? remoteImageKey(printingId) : null;
}

export type SyncProgress =
  | {
      type: "set";
      code: string;
      name: string;
      total: number;
      /** "fetching": downloading card data from the source; "saving": writing cards. */
      phase: "fetching" | "saving";
    }
  | {
      type: "card";
      code: string;
      done: number;
      total: number;
      name: string;
      number: string;
      imageKey: string | null;
      ok: boolean;
    };

/** The "detail" payloads the catalog job puts on the job event bus. */
type CatalogDetail = SyncProgress | { type: "set-counters"; code: string; counters: Counters };

/**
 * Writes one set and all its cards in a single transaction: either the whole
 * set lands, or (crash, error) none of it does — so a set is never left
 * half-written and then marked done.
 */
async function writeSet(
  adapter: CatalogSourceAdapter,
  gameId: number,
  sourceSet: SourceSet,
  printings: SourcePrinting[],
  assets: { logoUrl: string | null; symbolUrl: string | null },
  emit: (detail: CatalogDetail) => void,
  /** Write the cards into this existing set instead of creating one (see SET_MERGES). */
  merge: { setId: number; code: string; sortOffset: number } | null = null,
): Promise<Counters> {
  const counters = emptyCounters();
  const languageCode = adapter.languageCode;

  await prisma.$transaction(
    async (tx) => {
      const setData = {
        name: sourceSet.name,
        series: sourceSet.series ?? null,
        category: classifySet({
          game: adapter.game,
          code: sourceSet.code,
          name: sourceSet.name,
          series: sourceSet.series,
        }),
        primaryLangCode: languageCode,
        releaseDate: sourceSet.releaseDate ? new Date(sourceSet.releaseDate) : null,
        printedTotal: sourceSet.printedTotal ?? null,
        totalCards: sourceSet.totalCards ?? null,
        logoUrl: assets.logoUrl,
        symbolUrl: assets.symbolUrl,
      };
      const set = merge
        ? { id: merge.setId, code: merge.code }
        : await tx.set.upsert({
            where: { gameId_code: { gameId, code: sourceSet.code } },
            update: setData,
            create: { gameId, code: sourceSet.code, ...setData },
          });

      // Sources assign each printing (incl. alt arts) its own number, so
      // collisions shouldn't happen — but (setId, collectorNumber, isAltArt)
      // is unique, so a repeat is stored as the alt art rather than failing.
      const seenCollectorNumbers = new Set<string>();

      for (const [index, printing] of printings.entries()) {
        const isAltArt = seenCollectorNumbers.has(printing.collectorNumber);
        seenCollectorNumbers.add(printing.collectorNumber);

        const card = await upsertCard(tx, gameId, printing, counters);
        const rarity = printing.rarityName
          ? await tx.rarity.upsert({
              where: { gameId_name: { gameId, name: printing.rarityName } },
              update: {},
              create: { gameId, name: printing.rarityName },
            })
          : null;
        const artist = printing.artistName
          ? await tx.artist.upsert({
              where: { name: printing.artistName },
              update: {},
              create: { name: printing.artistName },
            })
          : null;

        const imageUrls =
          printing.imageUrls && printing.imageUrls.length > 0 ? printing.imageUrls : null;
        if (!imageUrls)
          counters.imagesMissing.push(`${printing.cardName} ${printing.collectorNumber}`);

        const printingData = {
          cardId: card.id,
          sortNumber: sortNumberFor(printing.collectorNumber) + (merge?.sortOffset ?? 0),
          subset: subsetFor({
            setCode: set.code,
            collectorNumber: printing.collectorNumber,
            rarityName: printing.rarityName,
            name: printing.cardName,
          }),
          rarityId: rarity?.id ?? null,
          artistId: artist?.id ?? null,
          imageUrls: imageUrls ? JSON.stringify(imageUrls) : null,
        };
        const existing = await tx.printing.findUnique({
          where: {
            setId_collectorNumber_isAltArt: {
              setId: set.id,
              collectorNumber: printing.collectorNumber,
              isAltArt,
            },
          },
        });
        let dbPrinting = existing
          ? await tx.printing.update({ where: { id: existing.id }, data: printingData })
          : await tx.printing.create({
              data: {
                setId: set.id,
                collectorNumber: printing.collectorNumber,
                isAltArt,
                ...printingData,
              },
            });
        if (existing) counters.printingsUpdated++;
        else counters.printingsCreated++;

        // Pokémon printings always get the lazy key: even without a stored URL the
        // image cache can try constructed CDN addresses (image-cache.ts). A custom
        // image (set by the user, never touched here) needs the key too.
        const imageKey = await imageKeyFor(
          existing?.imageKey,
          dbPrinting.id,
          imageUrls !== null || adapter.game === "pokemon" || !!dbPrinting.customImageKey,
        );
        if (imageKey !== dbPrinting.imageKey) {
          dbPrinting = await tx.printing.update({
            where: { id: dbPrinting.id },
            data: { imageKey },
          });
        }

        await tx.externalRef.upsert({
          where: {
            source_externalId: { source: adapter.slug, externalId: printing.externalCardId },
          },
          update: { printingId: dbPrinting.id },
          create: {
            source: adapter.slug,
            externalId: printing.externalCardId,
            printingId: dbPrinting.id,
          },
        });

        await syncVariants(tx, dbPrinting.id, languageCode, printing, counters);
        counters.priceObservations += await recordPrices(dbPrinting.id, printing.prices ?? [], tx);

        emit({
          type: "card",
          code: sourceSet.code,
          done: index + 1,
          total: printings.length,
          name: printing.cardName,
          number: printing.collectorNumber,
          imageKey: dbPrinting.imageKey,
          ok: true,
        });
      }
    },
    // Hundreds of cards x a handful of statements each; SQLite is quick, but
    // well past Prisma's 5 s default on a slow disk.
    { timeout: 180_000, maxWait: 30_000 },
  );

  counters.setsProcessed = 1;
  return counters;
}

async function processSet(
  adapter: CatalogSourceAdapter,
  gameId: number,
  item: ClaimedItem,
  emit: (detail: CatalogDetail) => void,
): Promise<void> {
  const code = item.key;
  emit({ type: "set", code, name: item.label ?? code, total: 0, phase: "fetching" });

  // All network first, then all writes: a download failing halfway leaves the DB untouched.
  const sourceSet = await adapter.getSet(code);
  if (!sourceSet) throw new SourceUnavailableError(`the source has no set "${code}"`);
  let printings = await adapter.listPrintings(code);
  if (printings.length === 0 && (sourceSet.totalCards ?? 0) > 0) {
    // One more look before believing it: a partial response can look the same.
    printings = await adapter.listPrintings(code);
    if (printings.length === 0) {
      // The source lists the set (with a card count) but has no cards for it:
      // a gap at the source, not a bug — parked as "unavailable", re-checked monthly.
      throw new SourceUnavailableError(
        `The source lists this set (${sourceSet.totalCards} cards) but has no card data for it yet.`,
      );
    }
  }

  // A set the source lists separately but that belongs inside another (Classic Collection
  // inside the 30th Celebration): its cards go into the parent, no set of its own.
  const mergeRule = mergeTarget(adapter.game, code);
  let merge: { setId: number; code: string; sortOffset: number } | null = null;
  if (mergeRule) {
    const parent = await prisma.set.findUnique({
      where: { gameId_code: { gameId, code: mergeRule.into } },
      select: { id: true },
    });
    if (!parent) throw new Error(`its parent set "${mergeRule.into}" isn't synced yet`);
    merge = { setId: parent.id, code: mergeRule.into, sortOffset: mergeRule.sortOffset };
  }

  const safeCode = sourceSet.code.replace(/[^\w.-]/g, "_");
  const assets = {
    logoUrl: await localAsset(sourceSet.logoUrl, `${adapter.game}/${safeCode}/logo.png`),
    symbolUrl: await localAsset(sourceSet.symbolUrl, `${adapter.game}/${safeCode}/symbol.png`),
  };

  emit({ type: "set", code, name: sourceSet.name, total: printings.length, phase: "saving" });
  const counters = await writeSet(adapter, gameId, sourceSet, printings, assets, emit, merge);
  emit({ type: "set-counters", code, counters });
}

/**
 * Gives sets that have no logo yet their logo from the source (one request,
 * no card data), for sets synced before the source provided any. Best-effort.
 */
export async function backfillSetLogos(
  adapter: CatalogSourceAdapter,
  log: (line: string) => void = () => {},
): Promise<number> {
  if (!adapter.listSetAssets) return 0;
  try {
    const missing = await prisma.set.findMany({
      where: { game: { slug: adapter.game }, logoUrl: null },
      select: { id: true, code: true },
    });
    if (missing.length === 0) return 0;
    const assets = new Map((await adapter.listSetAssets()).map((a) => [a.code, a]));
    let filled = 0;
    for (const set of missing) {
      const asset = assets.get(set.code);
      if (!asset?.logoUrl) continue;
      const safeCode = set.code.replace(/[^\w.-]/g, "_");
      const logoUrl = await localAsset(asset.logoUrl, `${adapter.game}/${safeCode}/logo.png`);
      if (!logoUrl) continue;
      await prisma.set.update({ where: { id: set.id }, data: { logoUrl } });
      filled++;
    }
    if (filled > 0) log(`added logos to ${filled} set(s)`);
    return filled;
  } catch (err) {
    log(`couldn't fetch set logos: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

export interface CatalogSyncOptions extends JobRunOptions {
  /** Structured progress, e.g. for the Sync page's live progress bars. */
  onProgress?: (event: SyncProgress) => void;
  /** Recompute valuations + today's portfolio snapshot when sets changed. Default true. */
  updateValuations?: boolean;
}

export interface CatalogSyncResult extends Counters {
  run: JobRunSummary;
  valuationsWritten: number;
}

/**
 * One background catalog sync run for `adapter`'s game: lists the source's
 * sets (new ones become `pending`), then syncs pending/failed sets and `done`
 * sets older than `refreshAfterMs` (30 days by default), newest sets first.
 * Returns with `run.status === "locked"` when a run is already in progress.
 */
export async function runCatalogSync(
  adapter: CatalogSourceAdapter,
  options: CatalogSyncOptions = {},
): Promise<CatalogSyncResult> {
  const game = await ensureGameAndLanguage(adapter);
  const totals = emptyCounters();

  const run = await runJob(
    {
      job: CATALOG_JOB,
      game: adapter.game,
      discover: async () => {
        const sets = await adapter.listSetSummaries();
        // Newest first from the source -> highest priority first.
        return sets.map((s, i) => ({ key: s.code, label: s.name, priority: sets.length - i }));
      },
      process: (item, ctx) =>
        processSet(adapter, game.id, item, (detail) => {
          if (detail.type === "set-counters") addCounters(totals, detail.counters);
          else options.onProgress?.(detail);
          ctx.detail(detail);
        }),
    },
    { concurrency: 2, delayMs: 1_000, ...options },
  );
  await backfillSetLogos(adapter, options.log);
  for (const failure of run.failed)
    totals.errors.push({ setCode: failure.key, message: failure.error });
  for (const gap of run.unavailable ?? [])
    totals.errors.push({ setCode: gap.key, message: `unavailable at the source: ${gap.reason}` });

  let valuationsWritten = 0;
  if (run.succeeded.length > 0 && options.updateValuations !== false) {
    options.log?.("computing valuations...");
    valuationsWritten = await computeValuations();
    await snapshotPortfolio();
  }
  return { ...totals, run, valuationsWritten };
}

export interface SyncResult extends Counters {
  /** Requested codes the source doesn't know. */
  unknownCodes: string[];
  valuationsWritten: number;
}

/**
 * Syncs specific sets now (Sync page, `--sets` CLI): queues them ahead of
 * everything else and runs the catalog job for just those. If a background
 * run already holds the lock, it picks them up next; this then waits for
 * them to finish so the caller still gets a result and live progress.
 */
export async function syncCatalogSets(
  codes: string[],
  options: CatalogSyncOptions = {},
  adapter: CatalogSourceAdapter,
): Promise<SyncResult> {
  await ensureGameAndLanguage(adapter);
  const requestedAt = new Date();
  await enqueueItems(
    CATALOG_JOB,
    adapter.game,
    codes.map((key) => ({ key })),
    MANUAL_PRIORITY,
  );

  const result = await runCatalogSync(adapter, {
    ...options,
    onlyKeys: codes,
    skipDiscovery: true,
  });
  if (result.run.status !== "locked") {
    return {
      ...result,
      unknownCodes: (result.run.unavailable ?? [])
        .filter((f) => /has no set/.test(f.reason))
        .map((f) => f.key),
    };
  }

  // Someone else is running the catalog job: follow along until our sets are through.
  options.log?.(
    "a sync is already running — your sets were queued at the front and will be synced next.",
  );
  const totals = emptyCounters();
  const wanted = new Set(codes);
  const unsubscribe = onJobEvent((e) => {
    if (
      e.job !== CATALOG_JOB ||
      e.game !== adapter.game ||
      e.type !== "detail" ||
      !wanted.has(e.key)
    )
      return;
    const detail = e.data as CatalogDetail;
    if (detail.type === "set-counters") addCounters(totals, detail.counters);
    else options.onProgress?.(detail);
  });
  try {
    for (;;) {
      const rows = await prisma.syncState.findMany({
        where: { job: CATALOG_JOB, game: adapter.game, itemKey: { in: codes } },
      });
      const finished = rows.filter(
        (r) =>
          (r.status === "done" || r.status === "failed" || r.status === "unavailable") &&
          r.lastAttemptAt !== null &&
          r.lastAttemptAt >= requestedAt,
      );
      if (finished.length === codes.length) {
        const failed = finished.filter((r) => r.status !== "done");
        for (const r of failed)
          totals.errors.push({ setCode: r.itemKey, message: r.lastError ?? "failed" });
        return {
          ...totals,
          unknownCodes: failed
            .filter((r) => r.status === "unavailable" && /has no set/.test(r.lastError ?? ""))
            .map((r) => r.itemKey),
          valuationsWritten: 0,
        };
      }
      if (options.signal?.aborted) throw new Error("cancelled");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } finally {
    unsubscribe();
  }
}

/** Every set code already in the local DB for a game — what "re-sync everything" re-queues. */
export async function syncedSetCodes(game: string): Promise<string[]> {
  const sets = await prisma.set.findMany({
    where: { game: { slug: game } },
    select: { code: true },
    orderBy: { releaseDate: "desc" },
  });
  return sets.map((s) => s.code);
}

export interface CatalogSyncStatus {
  game: string;
  total: number;
  done: number;
  pending: number;
  failed: number;
  syncing: number;
  /** Sets the source can't provide (parked, re-checked monthly; not failures). */
  unavailable: number;
  failures: CatalogSetIssue[];
  unavailableSets: CatalogSetIssue[];
}

/** A set that isn't synced, with what to tell the user about it. */
export interface CatalogSetIssue {
  code: string;
  name: string | null;
  /** The raw error / reason. */
  error: string | null;
  /** The same in plain language. */
  message: string;
  attempts: number;
  lastAttemptAt: Date | null;
}

/** Plain-language version of a sync error, for the sidebar and the Sync page. */
export function plainSyncError(error: string | null | undefined): string {
  const e = (error ?? "").trim();
  if (!e) return "Unknown error.";
  if (/interrupted/i.test(e)) return "The app was closed while this set was syncing. It will be retried.";
  if (/getSet is not a function|is not a function/.test(e))
    return `A bug in the app (${e}). Updating the app should fix it.`;
  if (/429|rate.?limit|too many requests/i.test(e))
    return "The source is rate-limiting requests. It will be retried later.";
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timed? ?out|fetch failed|network|socket/i.test(e))
    return `Couldn't reach the source (network problem or the source is down). It will be retried. (${e})`;
  if (/HTTP 5[0-9][0-9]/.test(e)) return `The source had a server error. It will be retried. (${e})`;
  if (/unique constraint/i.test(e))
    return "A bug in the app: two cards clashed while saving this set. Updating the app should fix it.";
  return e;
}

/** Sets done / total and the failed sets, from SyncState (works across processes). */
export async function catalogSyncStatus(game: string): Promise<CatalogSyncStatus> {
  const counts = await jobStateCounts(CATALOG_JOB, game);
  const issues = async (status: "failed" | "unavailable") =>
    (
      await prisma.syncState.findMany({
        where: { job: CATALOG_JOB, game, status },
        orderBy: { priority: "desc" },
        take: 100,
      })
    ).map(
      (f): CatalogSetIssue => ({
        code: f.itemKey,
        name: f.label,
        error: f.lastError,
        message: status === "unavailable" ? (f.lastError ?? "") : plainSyncError(f.lastError),
        attempts: f.attemptCount,
        lastAttemptAt: f.lastAttemptAt,
      }),
    );
  return {
    game,
    ...counts,
    failures: await issues("failed"),
    unavailableSets: await issues("unavailable"),
  };
}

export function formatSyncSummary(result: SyncResult): string[] {
  const lines = [
    `Sets processed:     ${result.setsProcessed}`,
    `Cards created:      ${result.cardsCreated}`,
    `Cards updated:      ${result.cardsUpdated}`,
    `Printings created:  ${result.printingsCreated}`,
    `Printings updated:  ${result.printingsUpdated}`,
    `Variants created:   ${result.variantsCreated}`,
    `Variants pruned:    ${result.variantsPruned}`,
  ];
  if (result.variantsKeptStale > 0) {
    lines.push(
      `Variants kept:      ${result.variantsKeptStale} (no longer reported by the source, but owned/priced — left in place)`,
    );
  }
  lines.push(
    ...(result.imagesMissing.length > 0
      ? [
          `Images not at the source yet: ${result.imagesMissing.length} (checked again on every sync) — ${result.imagesMissing.slice(0, 8).join(", ")}${result.imagesMissing.length > 8 ? ", …" : ""}`,
        ]
      : []),
    `Price observations: ${result.priceObservations}`,
    `Valuations written: ${result.valuationsWritten}`,
    `Errors:             ${result.errors.length}`,
  );
  for (const e of result.errors) {
    lines.push(
      `  - [${e.setCode}${e.collectorNumber ? ` ${e.collectorNumber}` : ""}] ${e.cardName ? `${e.cardName}: ` : ""}${e.message}`,
    );
  }
  return lines;
}
