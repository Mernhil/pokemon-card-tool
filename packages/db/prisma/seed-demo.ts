import { prisma } from "../src";

/**
 * Sample data to try the pricing UI without any network or API keys:
 * one card in a set called "DEMO — sample prices (not real)", owned once,
 * with two months of made-up prices from every provider (including a data
 * gap) and a month of portfolio history.
 *
 *   pnpm db:seed-demo             add (or reset) the demo card
 *   pnpm db:seed-demo -- --remove delete it again (and only it)
 */

const SET_CODE = "demo";
const DAY = 86_400_000;

async function remove(gameId: number) {
  const set = await prisma.set.findUnique({ where: { gameId_code: { gameId, code: SET_CODE } } });
  if (!set) return;
  const printings = await prisma.printing.findMany({
    where: { setId: set.id },
    include: { variants: true },
  });
  const variantIds = printings.flatMap((p) => p.variants.map((v) => v.id));
  await prisma.$transaction([
    prisma.binderSlot.updateMany({
      where: { collectionItem: { variantId: { in: variantIds } } },
      data: { collectionItemId: null },
    }),
    prisma.collectionItem.deleteMany({ where: { variantId: { in: variantIds } } }),
    prisma.priceObservation.deleteMany({ where: { variantId: { in: variantIds } } }),
    prisma.variantValuation.deleteMany({ where: { variantId: { in: variantIds } } }),
    prisma.providerMapping.deleteMany({ where: { variantId: { in: variantIds } } }),
    prisma.syncState.deleteMany({ where: { itemKey: { in: variantIds } } }),
    prisma.printVariant.deleteMany({ where: { id: { in: variantIds } } }),
    prisma.printing.deleteMany({ where: { setId: set.id } }),
    prisma.set.delete({ where: { id: set.id } }),
  ]);
}

async function main() {
  const game = await prisma.game.upsert({
    where: { slug: "pokemon" },
    update: {},
    create: { slug: "pokemon", name: "Pokémon" },
  });
  await prisma.language.upsert({
    where: { code: "en" },
    update: {},
    create: { code: "en", name: "English" },
  });
  await remove(game.id);
  if (process.argv.includes("--remove")) {
    console.log(
      "demo data removed (portfolio snapshots are recomputed on the next price refresh).",
    );
    return;
  }

  const set = await prisma.set.create({
    data: {
      gameId: game.id,
      code: SET_CODE,
      name: "DEMO — sample prices (not real)",
      printedTotal: 1,
      totalCards: 1,
    },
  });
  const card = await prisma.card.upsert({
    where: { gameId_canonicalKey: { gameId: game.id, canonicalKey: "demo-sample-card" } },
    update: {},
    create: {
      gameId: game.id,
      name: "Sample Card",
      cardType: "Pokemon",
      canonicalKey: "demo-sample-card",
    },
  });
  const printing = await prisma.printing.create({
    data: { cardId: card.id, setId: set.id, collectorNumber: "001/001", sortNumber: 1 },
  });
  const variant = await prisma.printVariant.create({
    data: { printingId: printing.id, languageCode: "en" },
  });
  await prisma.printVariant.create({
    data: { printingId: printing.id, finish: "REVERSE_HOLO", languageCode: "en" },
  });
  await prisma.collectionItem.create({
    data: {
      variantId: variant.id,
      condition: "NEAR_MINT",
      purchasePrice: 900,
      purchaseCurrency: "EUR",
      notes: "demo",
    },
  });

  const now = Date.now();
  const rows: Array<Record<string, unknown>> = [];
  for (let d = 60; d >= 0; d--) {
    if (d > 20 && d < 32) continue; // a gap, to show the chart breaking its lines
    const observedAt = new Date(now - d * DAY - 3_600_000);
    const w = 1 + Math.sin(d / 6) * 0.08;
    const add = (provider: string, kind: string, amount: number, currency: string, extra = {}) =>
      rows.push({
        provider,
        source: provider.toUpperCase(),
        kind,
        amount: Math.round(amount * w),
        currency,
        observedAt,
        ...extra,
      });
    add("cardmarket", "trend", 1150, "EUR");
    add("cardmarket", "market_average", 1210, "EUR");
    add("cardmarket", "lowest_listing", 890, "EUR");
    add("tcgplayer", "market_average", 1399, "USD");
    add("tcgplayer", "lowest_listing", 1100, "USD");
    if (d % 3 === 0 && d < 20) {
      add("cardtrader", "lowest_listing", 990, "EUR", { condition: "NEAR_MINT", listingCount: 14 });
      add("cardtrader", "lowest_listing", 760, "EUR", {
        condition: "LIGHTLY_PLAYED",
        listingCount: 4,
      });
      add("ebay", "asking", 1450, "USD", { listingCount: 9 });
      add("ebay", "lowest_listing", 1199, "USD", { listingCount: 9 });
    }
  }
  for (const row of rows) {
    await prisma.priceObservation.create({
      data: {
        variantId: variant.id,
        ...(row as {
          provider: string;
          source: string;
          kind: string;
          amount: number;
          currency: string;
          observedAt: Date;
        }),
      },
    });
  }
  for (const provider of ["cardmarket", "tcgplayer", "cardtrader", "ebay"]) {
    await prisma.providerMapping.create({
      data: {
        variantId: variant.id,
        provider,
        confidence: 1,
        status: "matched",
        notes: "Demo data",
        manualOverride: true,
      },
    });
  }
  console.log(
    `demo card added: open /pokemon/${SET_CODE}/001 (remove with pnpm db:seed-demo -- --remove)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
