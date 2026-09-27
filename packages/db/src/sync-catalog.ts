import { prisma } from "./client";
import { formatSyncSummary, syncCatalogSets, syncedSetCodes } from "./catalog-sync";
import { TcgdexPokemonAdapter } from "@tcg-vault/sources";

/**
 * CLI around syncCatalogSets (src/catalog-sync.ts).
 *
 * Usage:
 *   pnpm db:sync-catalog -- --sets sv06.5,sv03.5   sync specific sets
 *   pnpm db:sync-catalog -- --synced               re-sync every set already in the DB (refreshes prices)
 *   pnpm db:sync-catalog -- --all                  every Pokemon set TCGdex has
 *   add --refresh-images to re-download images that are already on disk
 *
 * Deliberately refuses to run with none of --sets/--synced/--all: this hits a
 * live network API and downloads card images, so "the whole catalog" must be
 * an explicit, opt-in choice, never an accident from a bare invocation.
 */

interface Args {
  all: boolean;
  synced: boolean;
  refreshImages: boolean;
  sets: string[] | null;
}

function splitCodes(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false, synced: false, refreshImages: false, sets: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") args.all = true;
    else if (arg === "--synced") args.synced = true;
    else if (arg === "--refresh-images") args.refreshImages = true;
    else if (arg === "--sets") args.sets = splitCodes(argv[++i]);
    else if (arg?.startsWith("--sets=")) args.sets = splitCodes(arg.slice("--sets=".length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adapter = new TcgdexPokemonAdapter();

  let codes: string[];
  if (args.all) {
    codes = (await adapter.listSetSummaries()).map((s) => s.code);
  } else if (args.synced) {
    codes = await syncedSetCodes();
  } else if (args.sets && args.sets.length > 0) {
    codes = args.sets;
  } else {
    console.error(
      "sync-catalog: refusing to run against the whole catalog by accident.\n" +
        "Pass --sets <code,code,...>, --synced (re-sync sets already in the DB), or --all.\n" +
        "Example: pnpm db:sync-catalog -- --sets sv06.5,sv03.5",
    );
    process.exitCode = 1;
    return;
  }

  const result = await syncCatalogSets(
    codes,
    { refreshImages: args.refreshImages, log: (line) => console.log(`sync-catalog: ${line}`) },
    adapter,
  );

  console.log("\n=== sync-catalog summary ===");
  for (const line of formatSyncSummary(result)) console.log(line);

  if (result.errors.length > 0 || result.unknownCodes.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
