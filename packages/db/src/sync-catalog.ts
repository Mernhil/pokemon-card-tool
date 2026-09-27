import { canonicalKeyFor, putFile } from "@tcg-vault/shared";
import { TcgdexPokemonAdapter, type SourcePrinting, type SourceSet } from "@tcg-vault/sources";
import { prisma } from "./index";

/**
 * Populates Game/Set/Rarity/Artist/Card/Printing/PrintVariant from a live
 * catalog source. Today that's only TCGdex, Pokemon, English — see the sprint
 * plan referenced from prisma/seed.ts for why the other games/languages are
 * out of scope for this pass.
 *
 * Usage:
 *   pnpm db:sync-catalog -- --sets sv8,sv9
 *   pnpm db:sync-catalog -- --all
 *
 * Deliberately refuses to run with neither flag: this hits a live network
 * API and downloads every card image for whatever it's given, so "the whole
 * catalog" must be an explicit, opt-in choice, never an accident from a bare
 * invocation.
 */

const GAME_SLUG = "pokemon";
const GAME_NAME = "Pokémon";
const LANGUAGE_CODE = "en";
const LANGUAGE_NAME = "English";

interface Args {
  all: boolean;
  sets: string[] | null;
}

function parseArgs(argv: string[]): Args {
  let all = false;
  let sets: string[] | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--sets") {
      const value = argv[i + 1];
      sets = splitCodes(value);
      i++;
    } else if (arg?.startsWith("--sets=")) {
      sets = splitCodes(arg.slice("--sets=".length));
    }
  }

  return { all, sets };
}

function splitCodes(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

interface Counters {
  setsProcessed: number;
  cardsCreated: number;
  cardsUpdated: number;
  printingsCreated: number;
  printingsUpdated: number;
  imagesDownloaded: number;
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
function imageKeyFor(setCode: string, collectorNumber: string, isAltArt: boolean): string {
  const safeNumber = collectorNumber.replace(/[\\/]/g, "-");
  return `pokemon/${setCode}/${safeNumber}${isAltArt ? "-alt" : ""}.webp`;
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

async function upsertSet(gameId: number, sourceSet: SourceSet) {
  const data = {
    name: sourceSet.name,
    series: sourceSet.series ?? null,
    primaryLangCode: LANGUAGE_CODE,
    releaseDate: sourceSet.releaseDate ? new Date(sourceSet.releaseDate) : null,
    printedTotal: sourceSet.printedTotal ?? null,
    totalCards: sourceSet.totalCards ?? null,
    logoUrl: sourceSet.logoUrl ?? null,
    symbolUrl: sourceSet.symbolUrl ?? null,
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

async function syncSet(
  game: { id: number },
  sourceSet: SourceSet,
  adapter: TcgdexPokemonAdapter,
  counters: Counters,
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

      let imageKey: string | null = null;
      if (printing.imageUrl) {
        try {
          const key = imageKeyFor(sourceSet.code, printing.collectorNumber, isAltArt);
          const bytes = await downloadImage(printing.imageUrl);
          await putFile(key, bytes);
          imageKey = key;
          counters.imagesDownloaded++;
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

      const existingPrinting = await prisma.printing.findUnique({
        where: {
          setId_collectorNumber_isAltArt: {
            setId: set.id,
            collectorNumber: printing.collectorNumber,
            isAltArt,
          },
        },
      });

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

      await prisma.printVariant.upsert({
        where: {
          printingId_finish_edition_languageCode: {
            printingId: dbPrinting.id,
            finish: "NON_FOIL",
            edition: "UNLIMITED",
            languageCode: LANGUAGE_CODE,
          },
        },
        update: {},
        create: {
          printingId: dbPrinting.id,
          finish: "NON_FOIL",
          edition: "UNLIMITED",
          languageCode: LANGUAGE_CODE,
        },
      });
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

async function main() {
  const { all, sets: requestedCodes } = parseArgs(process.argv.slice(2));

  if (!all && (!requestedCodes || requestedCodes.length === 0)) {
    console.error(
      "sync-catalog: refusing to run against the whole catalog by accident.\n" +
        "Pass --sets <code,code,...> to sync specific sets, or --all to sync every Pokemon set.\n" +
        "Example: pnpm db:sync-catalog -- --sets sv8,sv9",
    );
    process.exitCode = 1;
    return;
  }

  const adapter = new TcgdexPokemonAdapter();
  const game = await ensureGameAndLanguage();

  console.log("sync-catalog: fetching set list from TCGdex...");
  const allSets = await adapter.listSets();
  const byCode = new Map(allSets.map((s) => [s.code.toLowerCase(), s]));

  let targets: SourceSet[];
  if (all) {
    targets = allSets;
  } else {
    targets = [];
    for (const code of requestedCodes!) {
      const found = byCode.get(code.toLowerCase());
      if (!found) {
        console.error(`sync-catalog: no TCGdex set found for code "${code}" — skipping.`);
        continue;
      }
      targets.push(found);
    }
  }

  const counters: Counters = {
    setsProcessed: 0,
    cardsCreated: 0,
    cardsUpdated: 0,
    printingsCreated: 0,
    printingsUpdated: 0,
    imagesDownloaded: 0,
    errors: [],
  };

  for (const sourceSet of targets) {
    console.log(`sync-catalog: syncing ${sourceSet.code} (${sourceSet.name})...`);
    await syncSet(game, sourceSet, adapter, counters);
  }

  console.log("\n=== sync-catalog summary ===");
  console.log(`Sets processed:     ${counters.setsProcessed}`);
  console.log(`Cards created:      ${counters.cardsCreated}`);
  console.log(`Cards updated:      ${counters.cardsUpdated}`);
  console.log(`Printings created:  ${counters.printingsCreated}`);
  console.log(`Printings updated:  ${counters.printingsUpdated}`);
  console.log(`Images downloaded:  ${counters.imagesDownloaded}`);
  console.log(`Per-card errors:    ${counters.errors.length}`);
  for (const e of counters.errors) {
    console.log(
      `  - [${e.setCode} ${e.collectorNumber ?? "?"}] ${e.cardName ?? "?"}: ${e.message}`,
    );
  }

  if (counters.errors.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
