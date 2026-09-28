import { PRICE_PROVIDERS, type PriceProviderId } from "@tcg-vault/shared";
import { createPriceProviders } from "@tcg-vault/sources";
import { prisma } from "./client";
import { refreshFxRates } from "./fx";
import { enqueuePriceRefresh, runPriceRefresh } from "./price-refresh";
import { getSettings, readSecrets } from "./settings";
import { computeValuations, snapshotPortfolio } from "./valuations";

/**
 * CLI for the background price refresh (src/price-refresh.ts), with the
 * same settings, keys (secrets.json / env) and job state as the app.
 *
 *   pnpm db:sync-prices                          refresh stale collection / recently viewed cards
 *   pnpm db:sync-prices -- --provider cardtrader only one provider
 *   pnpm db:sync-prices -- --variants <id,id>    refresh these variants now, stale or not
 *
 * Then refreshes exchange rates, valuations and today's portfolio snapshot.
 */
async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = arg("--provider") as PriceProviderId | undefined;
  if (only && !(PRICE_PROVIDERS as readonly string[]).includes(only)) {
    console.error(`unknown provider "${only}" (one of ${PRICE_PROVIDERS.join(", ")})`);
    process.exitCode = 1;
    return;
  }
  const game = arg("--game") ?? "pokemon";
  const variants = arg("--variants")?.split(",").filter(Boolean);
  if (variants?.length) await enqueuePriceRefresh(variants, game);

  const [settings, secrets] = await Promise.all([getSettings(), readSecrets()]);
  const providers = createPriceProviders({
    ...secrets,
    ebayMarketplaceId: settings.ebay.marketplaceId,
    ebayEnvironment: settings.ebay.environment,
  });
  const log = (line: string) => console.log(`sync-prices: ${line}`);

  const fx = await refreshFxRates({ log });
  if (fx.failed.length)
    log(`exchange rates: ${fx.failed[0]!.error} (keeping the previous/built-in rates)`);

  for (const id of only ? [only] : PRICE_PROVIDERS) {
    if (!settings.providers[id].enabled) {
      log(`${id}: disabled in Settings`);
      continue;
    }
    const result = await runPriceRefresh(providers[id], game, {
      refreshAfterMs: settings.priceRefreshHours * 3_600_000,
      log: (line) => log(`${id}: ${line}`),
    });
    log(
      `${id}: ${result.skipped ?? result.status} — ${result.succeeded.length} refreshed, ${result.failed.length} failed`,
    );
    for (const f of result.failed.slice(0, 5)) log(`  ${f.label ?? f.key}: ${f.error}`);
    if (result.failed.length) process.exitCode = 1;
  }

  log(`valuations written: ${await computeValuations()}`);
  await snapshotPortfolio();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
