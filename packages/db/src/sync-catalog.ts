import { TcgdexPokemonAdapter } from "@tcg-vault/sources";
import { prisma } from "./client";
import {
  CATALOG_JOB,
  MANUAL_PRIORITY,
  catalogSyncStatus,
  formatSyncSummary,
  runCatalogSync,
  syncCatalogSets,
  syncedSetCodes,
} from "./catalog-sync";
import { enqueueItems, retryFailedItems } from "./jobs/runner";

/**
 * CLI around the background catalog sync (src/catalog-sync.ts). Uses the same
 * SyncState rows and lock as the app, so it's safe to run while the app is
 * open (it waits or queues instead of syncing twice).
 *
 * Usage:
 *   pnpm db:sync-catalog -- --all                  what the app does in the background: every set,
 *                                                  new/failed/stale ones only, newest first
 *   pnpm db:sync-catalog -- --sets sv06.5,sv03.5   sync specific sets now
 *   pnpm db:sync-catalog -- --synced               re-sync every set already in the DB
 *   pnpm db:sync-catalog -- --retry-failed         retry sets that failed last time
 *   pnpm db:sync-catalog -- --status               show progress and failures, sync nothing
 *   add --refresh-days <n> to change how old a synced set must be before it's re-synced (default 30)
 *
 * A bare invocation prints this help instead of hitting the network.
 */

interface Args {
  all: boolean;
  synced: boolean;
  retryFailed: boolean;
  status: boolean;
  sets: string[] | null;
  refreshDays: number | null;
  obsoleteRefreshImages: boolean;
}

function splitCodes(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    all: false,
    synced: false,
    retryFailed: false,
    status: false,
    sets: null,
    refreshDays: null,
    obsoleteRefreshImages: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") args.all = true;
    else if (arg === "--synced") args.synced = true;
    else if (arg === "--retry-failed") args.retryFailed = true;
    else if (arg === "--status") args.status = true;
    else if (arg === "--refresh-images") args.obsoleteRefreshImages = true;
    else if (arg === "--sets") args.sets = splitCodes(argv[++i]);
    else if (arg?.startsWith("--sets=")) args.sets = splitCodes(arg.slice("--sets=".length));
    else if (arg === "--refresh-days") args.refreshDays = Number(argv[++i]);
  }
  return args;
}

const log = (line: string) => console.log(`sync-catalog: ${line}`);

async function printStatus(game: string) {
  const status = await catalogSyncStatus(game);
  console.log(
    `${game}: ${status.done}/${status.total} sets synced, ${status.pending} pending, ${status.failed} failed, ${status.syncing} in progress`,
  );
  for (const f of status.failures) {
    console.log(`  - ${f.name ?? f.code} (${f.code}), ${f.attempts} attempt(s): ${f.error ?? "?"}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adapter = new TcgdexPokemonAdapter();
  if (args.obsoleteRefreshImages) {
    log("--refresh-images is no longer needed: images are fetched on first view and cached (see apps/web/lib/image-cache.ts).");
  }
  const refreshAfterMs =
    args.refreshDays !== null && Number.isFinite(args.refreshDays) && args.refreshDays >= 0
      ? args.refreshDays * 86_400_000
      : undefined;

  if (args.status) {
    await printStatus(adapter.game);
    return;
  }

  if (args.sets && args.sets.length > 0) {
    const result = await syncCatalogSets(args.sets, { log, refreshAfterMs }, adapter);
    console.log("\n=== sync-catalog summary ===");
    for (const line of formatSyncSummary(result)) console.log(line);
    if (result.errors.length > 0 || result.unknownCodes.length > 0) process.exitCode = 1;
    return;
  }

  if (args.synced) {
    const codes = await syncedSetCodes(adapter.game);
    await enqueueItems(CATALOG_JOB, adapter.game, codes.map((key) => ({ key })), MANUAL_PRIORITY - 1);
    log(`queued ${codes.length} synced set(s) for a re-sync.`);
  } else if (args.retryFailed) {
    log(`queued ${await retryFailedItems(CATALOG_JOB, adapter.game)} failed set(s) again.`);
  } else if (!args.all) {
    console.error(
      "sync-catalog: nothing to do. Pass one of:\n" +
        "  --all              sync every set (new, failed and stale ones), newest first\n" +
        "  --sets <a,b,...>   sync specific sets now\n" +
        "  --synced           re-sync every set already in the DB\n" +
        "  --retry-failed     retry sets that failed last time\n" +
        "  --status           show progress\n" +
        "Example: pnpm db:sync-catalog -- --sets sv06.5,sv03.5",
    );
    process.exitCode = 1;
    return;
  }

  const result = await runCatalogSync(adapter, { log, refreshAfterMs });
  if (result.run.status === "locked") {
    log("another sync (probably the app) is already running; it will pick up anything queued above.");
    return;
  }
  console.log("\n=== sync-catalog summary ===");
  for (const line of formatSyncSummary({ ...result, unknownCodes: [] })) console.log(line);
  await printStatus(adapter.game);
  if (result.run.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
