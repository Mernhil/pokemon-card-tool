import { canonicalKeyFor, hasFile, mediaUrl, putFile } from "@tcg-vault/shared";
import { TcgdexPokemonAdapter, type SourcePrinting, type SourceSet } from "@tcg-vault/sources";
import { prisma } from "./client";
import { recordPrices } from "./prices";
import { computeValuations, snapshotPortfolio } from "./valuations";

/**
 * Populates Game/Set/Rarity/Artist/Card/Printing/PrintVariant (+ the market
 * prices TCGdex bundles with each card) from a live catalog source. Today
 * that's only TCGdex, Pokemon, English.
 *
 * Driven by the `pnpm db:sync-catalog` CLI (src/sync-catalog.ts) and by the
 * in-app Sync page (apps/web/app/sync). Safe to re-run: everything is an
 * upsert, images are only downloaded when a printing doesn't have one yet,
 * and each run appends fresh price observations — so re-syncing a set is
 * also how its prices get refreshed.
 */

const GAME_SLUG = "pokemon";
const GAME_NAME = "Pokémon";
const LANGUAGE_CODE = "en";
const LANGUAGE_NAME = "English";

export interface Counters {
  setsProcessed: number;
  cardsCreated: number;
  cardsUpdated: number;
  printingsCreated: number;
  printingsUpdated: number;
  variantsCreated: number;
  variantsPruned: number;
  variantsKeptStale: number;
  imagesDownloaded: number;
  /** Cards the source has no image for yet; retried on every later sync. */
  imagesMissing: string[];
  priceObservations: number;
  errors: Array<{ setCode: string; collectorNumber?: string; cardName?: string; message: string }>;
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

/** Filesystem-safe local-storage key for a printing's master scan (collectorNumber may contain "/"). */
function imageKeyFor(
  setCode: string,
  collectorNumber: string,
  isAltArt: boolean,
  ext: string,
): string {
  const safeNumber = collectorNumber.replace(/[\\/]/g, "-");
  return `pokemon/${setCode}/${safeNumber}${isAltArt ? "-alt" : ""}.${ext}`;
}

/**
 * Downloads the first candidate URL that exists. A 404 means "not this one,
 * try the next"; anything else (network down, 5xx, rate limit) throws so it
 * is reported as a real error. Returns null when the source simply has no
 * image for the card (yet) — common for sets released in the last weeks.
 */
async function downloadFirstImage(urls: string[]): Promise<{ bytes: Buffer; ext: string } | null> {
  for (const url of urls) {
    const res = await fetch(url);
    if (res.status === 404) continue;
    if (!res.ok) {
      throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    }
    const ext = url.split(".").pop()?.toLowerCase() ?? "webp";
    return { bytes: Buffer.from(await res.arrayBuffer()), ext };
  }
  return null;
}

async function ensureGameAndLanguage() {
  const game = await prisma.game.upsert({
    where: { slug: GAME_SLUG },
    update: {},
    create: { slug: GAME_SLUG, name: GAME_NAME },
  });

  await prisma.language.upsert({
    where: { code: LANGUAGE_CODE },
    update: {},
    create: { code: LANGUAGE_CODE, name: LANGUAGE_NAME },
  });

  return game;
}

/**
 * Keeps a copy of a set's logo/symbol in local media so pages don't load
 * them from the internet (they work offline and don't leak requests).
 * Returns the local /media URL, or the remote URL if it couldn't be fetched.
 */
async function localAsset(remote: string | undefined, key: string): Promise<string | null> {
  if (!remote) return null;
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

async function upsertSet(gameId: number, sourceSet: SourceSet) {
  const safeCode = sourceSet.code.replace(/[^\w.-]/g, "_");
  const logoUrl = await localAsset(sourceSet.logoUrl, `pokemon/${safeCode}/logo.png`);
  const symbolUrl = await localAsset(sourceSet.symbolUrl, `pokemon/${safeCode}/symbol.png`);
  const data = {
    name: sourceSet.name,
    series: sourceSet.series ?? null,
    primaryLangCode: LANGUAGE_CODE,
    releaseDate: sourceSet.releaseDate ? new Date(sourceSet.releaseDate) : null,
    printedTotal: sourceSet.printedTotal ?? null,
    totalCards: sourceSet.totalCards ?? null,
    logoUrl,
    symbolUrl,
  };

  return prisma.set.upsert({
    where: { gameId_code: { gameId, code: sourceSet.code } },
    update: data,
    create: { gameId, code: sourceSet.code, ...data },
  });
}

async function upsertRarity(gameId: number, name: string) {
  return prisma.rarity.upsert({
    where: { gameId_name: { gameId, name } },
    update: {},
    create: { gameId, name },
  });
}

async function upsertArtist(name: string) {
  return prisma.artist.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

async function upsertCard(
  gameId: number,
  printing: SourcePrinting,
  rulesText: string | undefined,
  counters: Counters,
) {
  const canonicalKey = canonicalKeyFor(printing.cardName, rulesText);
  const data = {
    name: printing.cardName,
    cardType: printing.cardType,
    subtypes: JSON.stringify(printing.subtypes),
    rulesText: rulesText ?? null,
    attributes: JSON.stringify(printing.attributes),
  };

  const existing = await prisma.card.findUnique({
    where: { gameId_canonicalKey: { gameId, canonicalKey } },
  });
  if (existing) {
    counters.cardsUpdated++;
    return prisma.card.update({ where: { id: existing.id }, data });
  }
  counters.cardsCreated++;
  return prisma.card.create({ data: { gameId, canonicalKey, ...data } });
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
async function syncVariants(printingId: string, printing: SourcePrinting, counters: Counters) {
  const reported = printing.finishes ?? [];
  const finishes = reported.length > 0 ? reported : ["NON_FOIL"];

  for (const finish of finishes) {
    const key = { printingId, finish, edition: "UNLIMITED", languageCode: LANGUAGE_CODE };
    const existing = await prisma.printVariant.findUnique({
      where: { printingId_finish_edition_languageCode: key },
    });
    if (!existing) {
      await prisma.printVariant.create({ data: key });
      counters.variantsCreated++;
    }
  }

  // Nothing reported means nothing to prune against — don't treat "unknown"
  // as "only NON_FOIL exists".
  if (reported.length === 0) return;

  const stale = await prisma.printVariant.findMany({
    where: {
      printingId,
      edition: "UNLIMITED",
      languageCode: LANGUAGE_CODE,
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
      (await prisma.binderSlot.count({ where: { placeholderVariantId: variant.id } })) > 0;
    if (referenced) {
      counters.variantsKeptStale++;
      continue;
    }
    await prisma.printVariant.delete({ where: { id: variant.id } });
    counters.variantsPruned++;
  }
}

async function syncSet(
  game: { id: number },
  sourceSet: SourceSet,
  adapter: TcgdexPokemonAdapter,
  counters: Counters,
  options: SyncOptions,
) {
  const set = await upsertSet(game.id, sourceSet);
  const printings = await adapter.listPrintings(sourceSet.code);

  // TCGdex assigns each printing (including alt arts) its own localId, so
  // collisions shouldn't happen in practice — but the schema's uniqueness on
  // (setId, collectorNumber, isAltArt) depends on us never trying to create
  // two rows with the same pair, so defend against it anyway.
  const seenCollectorNumbers = new Set<string>();

  for (const printing of printings) {
    try {
      const isAltArt = seenCollectorNumbers.has(printing.collectorNumber);
      seenCollectorNumbers.add(printing.collectorNumber);

      const rulesText = deriveRulesText(printing.attributes);
      const card = await upsertCard(game.id, printing, rulesText, counters);

      const rarity = printing.rarityName ? await upsertRarity(game.id, printing.rarityName) : null;
      const artist = printing.artistName ? await upsertArtist(printing.artistName) : null;

      const existingPrinting = await prisma.printing.findUnique({
        where: {
          setId_collectorNumber_isAltArt: {
            setId: set.id,
            collectorNumber: printing.collectorNumber,
            isAltArt,
          },
        },
      });

      let imageKey: string | null = null;
      const needsImage =
        options.refreshImages ||
        !existingPrinting?.imageKey ||
        !(await hasFile(existingPrinting.imageKey));
      if (needsImage && (!printing.imageUrls || printing.imageUrls.length === 0)) {
        counters.imagesMissing.push(`${printing.cardName} ${printing.collectorNumber}`);
      } else if (printing.imageUrls && needsImage) {
        try {
          const image = await downloadFirstImage(printing.imageUrls);
          if (image) {
            const key = imageKeyFor(sourceSet.code, printing.collectorNumber, isAltArt, image.ext);
            await putFile(key, image.bytes);
            imageKey = key;
            counters.imagesDownloaded++;
          } else {
            counters.imagesMissing.push(`${printing.cardName} ${printing.collectorNumber}`);
          }
        } catch (err) {
          counters.errors.push({
            setCode: sourceSet.code,
            collectorNumber: printing.collectorNumber,
            cardName: printing.cardName,
            message: `image download failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      const printingData = {
        cardId: card.id,
        sortNumber: sortNumberFor(printing.collectorNumber),
        rarityId: rarity?.id ?? null,
        artistId: artist?.id ?? null,
        ...(imageKey ? { imageKey } : {}),
      };

      const dbPrinting = existingPrinting
        ? await (async () => {
            counters.printingsUpdated++;
            return prisma.printing.update({
              where: { id: existingPrinting.id },
              data: printingData,
            });
          })()
        : await (async () => {
            counters.printingsCreated++;
            return prisma.printing.create({
              data: {
                setId: set.id,
                collectorNumber: printing.collectorNumber,
                isAltArt,
                ...printingData,
              },
            });
          })();

      await syncVariants(dbPrinting.id, printing, counters);
      counters.priceObservations += await recordPrices(dbPrinting.id, printing.prices ?? []);
    } catch (err) {
      counters.errors.push({
        setCode: sourceSet.code,
        collectorNumber: printing.collectorNumber,
        cardName: printing.cardName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  counters.setsProcessed++;
}

export interface SyncOptions {
  /** Re-download every card image, even ones already on disk. */
  refreshImages?: boolean;
  /** Progress lines; defaults to console.log. */
  log?: (line: string) => void;
}

export interface SyncResult extends Counters {
  /** Requested codes TCGdex doesn't know. */
  unknownCodes: string[];
  valuationsWritten: number;
}

/**
 * Syncs the given TCGdex set codes (e.g. ["sv06.5", "sv03.5"]), then
 * recomputes valuations and today's portfolio snapshot.
 */
export async function syncCatalogSets(
  codes: string[],
  options: SyncOptions = {},
  adapter = new TcgdexPokemonAdapter(),
): Promise<SyncResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const game = await ensureGameAndLanguage();

  const counters: Counters = {
    setsProcessed: 0,
    cardsCreated: 0,
    cardsUpdated: 0,
    printingsCreated: 0,
    printingsUpdated: 0,
    variantsCreated: 0,
    variantsPruned: 0,
    variantsKeptStale: 0,
    imagesDownloaded: 0,
    imagesMissing: [],
    priceObservations: 0,
    errors: [],
  };
  const unknownCodes: string[] = [];

  for (const code of codes) {
    // Network errors here (TCGdex unreachable) propagate: nothing can be synced.
    const sourceSet = await adapter.getSet(code);
    if (!sourceSet) {
      log(`no TCGdex set found for code "${code}" — skipping.`);
      unknownCodes.push(code);
      continue;
    }
    log(`syncing ${sourceSet.code} (${sourceSet.name})...`);
    try {
      await syncSet(game, sourceSet, adapter, counters, options);
    } catch (err) {
      // Keep going: sets already synced stay synced, and the next set may work.
      const message = err instanceof Error ? err.message : String(err);
      log(`  ${sourceSet.code} failed: ${message}`);
      counters.errors.push({ setCode: sourceSet.code, message });
    }
  }

  log("computing valuations...");
  const valuationsWritten = await computeValuations();
  await snapshotPortfolio();

  return { ...counters, unknownCodes, valuationsWritten };
}

/** Every set code already in the local DB for Pokemon — what "refresh prices" re-syncs. */
export async function syncedSetCodes(): Promise<string[]> {
  const sets = await prisma.set.findMany({
    where: { game: { slug: GAME_SLUG } },
    select: { code: true },
    orderBy: { releaseDate: "desc" },
  });
  return sets.map((s) => s.code);
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
    `Images downloaded:  ${result.imagesDownloaded}`,
    ...(result.imagesMissing.length > 0
      ? [
          `Images not on TCGdex yet: ${result.imagesMissing.length} (tried again on every sync) — ${result.imagesMissing.slice(0, 8).join(", ")}${result.imagesMissing.length > 8 ? ", …" : ""}`,
        ]
      : []),
    `Price observations: ${result.priceObservations}`,
    `Valuations written: ${result.valuationsWritten}`,
    `Per-card errors:    ${result.errors.length}`,
  );
  for (const e of result.errors) {
    lines.push(`  - [${e.setCode} ${e.collectorNumber ?? "?"}] ${e.cardName ?? "?"}: ${e.message}`);
  }
  return lines;
}
