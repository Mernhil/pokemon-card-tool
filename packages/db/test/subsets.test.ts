import type { CatalogSourceAdapter, SourcePrinting, SourceSet } from "@tcg-vault/sources";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runCatalogSync } from "../src/catalog-sync";
import { prisma } from "../src/client";
import { backfillSubsets, mergeStraySets } from "../src/subsets";
import { fakeClock, resetDb } from "./helpers";

let n = 0;
async function setup() {
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
  const main = await prisma.set.create({
    data: { gameId: game.id, code: "30th", name: "30th Celebration" },
  });
  const stray = await prisma.set.create({
    data: { gameId: game.id, code: "30th-c", name: "30th Classic Collection" },
  });
  const rarity = await prisma.rarity.create({
    data: { gameId: game.id, name: "Special illustration rare" },
  });
  const mk = async (setId: number, collectorNumber: string, sortNumber: number, rarityId?: number) => {
    const i = ++n;
    const card = await prisma.card.create({
      data: { gameId: game.id, name: `Card ${i}`, cardType: "Pokemon", canonicalKey: `k${i}` },
    });
    const printing = await prisma.printing.create({
      data: { cardId: card.id, setId, collectorNumber, sortNumber, rarityId },
    });
    const variant = await prisma.printVariant.create({
      data: { printingId: printing.id, languageCode: "en" },
    });
    return { printing, variant };
  };
  return { game, main, stray, rarity, mk };
}

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("mergeStraySets", () => {
  it("moves the Classic Collection into the 30th Celebration without losing anything owned", async () => {
    const { main, stray, mk } = await setup();
    await mk(main.id, "001/128", 1);
    const classic = await mk(stray.id, "001/30", 1);
    const item = await prisma.collectionItem.create({
      data: { variantId: classic.variant.id, quantity: 2 },
    });
    await prisma.priceObservation.create({
      data: {
        variantId: classic.variant.id,
        source: "CARDMARKET",
        currency: "EUR",
        observedAt: new Date(),
        amount: 500,
      },
    });
    const binder = await prisma.binder.create({ data: { name: "B", setId: stray.id } });

    expect(await mergeStraySets()).toBe(1);

    expect(await prisma.set.findFirst({ where: { code: "30th-c" } })).toBeNull();
    const moved = await prisma.printing.findUniqueOrThrow({ where: { id: classic.printing.id } });
    expect(moved.setId).toBe(main.id);
    expect(moved.sortNumber).toBe(1001); // after the set's own cards
    expect(await prisma.printing.count({ where: { setId: main.id } })).toBe(2);
    // Owned copies, price history and the binder's set link all survive.
    expect((await prisma.collectionItem.findUniqueOrThrow({ where: { id: item.id } })).variantId).toBe(
      classic.variant.id,
    );
    expect(await prisma.priceObservation.count({ where: { variantId: classic.variant.id } })).toBe(1);
    expect((await prisma.binder.findUniqueOrThrow({ where: { id: binder.id } })).setId).toBe(main.id);

    // Idempotent.
    expect(await mergeStraySets()).toBe(0);
  });

  it("leaves everything alone when a card would collide, or the parent is missing", async () => {
    const { main, stray, mk } = await setup();
    await mk(main.id, "001/30", 1);
    await mk(stray.id, "001/30", 1);
    expect(await mergeStraySets()).toBe(0);
    expect(await prisma.set.findFirst({ where: { code: "30th-c" } })).not.toBeNull();
    // Parent missing (renamed away): nothing to merge into.
    await prisma.set.update({ where: { id: main.id }, data: { code: "elsewhere" } });
    expect(await mergeStraySets()).toBe(0);
  });
});

describe("backfillSubsets", () => {
  it("labels printings by rule, leaves other sets alone, and is idempotent", async () => {
    const { main, stray, rarity, mk } = await setup();
    const art = await mk(main.id, "147", 147, rarity.id);
    const plain = await mk(main.id, "001/128", 1);
    const classic = await mk(stray.id, "001/30", 1);
    await mergeStraySets();
    const other = await prisma.set.create({ data: { gameId: main.gameId, code: "sv01", name: "SV" } });
    const elsewhere = await mk(other.id, "001/198", 1, rarity.id);

    expect(await backfillSubsets()).toBe(2);
    const subset = async (id: string) =>
      (await prisma.printing.findUniqueOrThrow({ where: { id } })).subset;
    expect(await subset(art.printing.id)).toBe("Special Art");
    expect(await subset(classic.printing.id)).toBe("Classic Collection");
    expect(await subset(plain.printing.id)).toBeNull();
    expect(await subset(elsewhere.printing.id)).toBeNull(); // a set without subsets is untouched
    expect(await backfillSubsets()).toBe(0);
  });
});

describe("catalog sync with a merged set", () => {
  function adapter(codes: Record<string, SourcePrinting[]>): CatalogSourceAdapter {
    const sets: Record<string, SourceSet> = Object.fromEntries(
      Object.entries(codes).map(([code, cards]) => [
        code,
        { code, name: `Set ${code}`, totalCards: cards.length },
      ]),
    );
    return {
      slug: "fake",
      game: "pokemon",
      languageCode: "en",
      listSets: async () => Object.values(sets),
      listSetSummaries: async () =>
        Object.values(sets).map((s) => ({ code: s.code, name: s.name })),
      getSet: async (c) => sets[c] ?? null,
      listPrintings: async (c) => codes[c] ?? [],
    };
  }
  const card = (num: string, rarityName?: string): SourcePrinting => ({
    externalCardId: `x-${num}`,
    cardName: `Card ${num}`,
    cardType: "Pokemon",
    subtypes: [],
    collectorNumber: num,
    rarityName,
    attributes: {},
  });

  it("writes the Classic Collection into the parent set, with subsets, and never creates a set for it", async () => {
    const clock = fakeClock();
    await runCatalogSync(
      adapter({
        "30th": [card("001/128", "Common"), card("147", "Special illustration rare")],
        "30th-c": [card("001/30")],
      }),
      {
        now: clock.now,
        sleep: async () => {},
        random: () => 1,
        delayMs: 0,
        concurrency: 1,
        maxAttempts: 1,
        updateValuations: false,
      },
    );
    expect((await prisma.set.findMany()).map((s) => s.code)).toEqual(["30th"]);
    const printings = await prisma.printing.findMany({ orderBy: { sortNumber: "asc" } });
    expect(printings.map((p) => [p.collectorNumber, p.subset])).toEqual([
      ["001/128", null],
      ["147", "Special Art"],
      ["001/30", "Classic Collection"],
    ]);
  });
});
