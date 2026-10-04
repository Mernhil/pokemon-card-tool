import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { loadPricedCard } from "../src/price-refresh";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

let n = 0;
async function printing(
  gameId: number,
  setId: number,
  name: string,
  collectorNumber: string,
  languageCode: string,
  ref?: { source: string; externalId: string },
) {
  const i = ++n;
  const card = await prisma.card.create({
    data: { gameId, name, cardType: "Pokemon", canonicalKey: `k${i}-${languageCode}` },
  });
  const p = await prisma.printing.create({
    data: { cardId: card.id, setId, collectorNumber, sortNumber: i },
  });
  if (ref) await prisma.externalRef.create({ data: { ...ref, printingId: p.id } });
  const variant = await prisma.printVariant.create({
    data: { printingId: p.id, languageCode, finish: "HOLO" },
  });
  return variant;
}

async function setup() {
  const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokémon" } });
  for (const code of ["en", "it", "fr"])
    await prisma.language.create({ data: { code, name: code } });
  // The English Classic Collection was merged into "30th"; the Italian one is its own set.
  const en30 = await prisma.set.create({
    data: { gameId: game.id, code: "30th", name: "30th Celebration" },
  });
  const it30c = await prisma.set.create({
    data: { gameId: game.id, code: "it-30th-c", name: "Collzione Classica del 30°" },
  });
  return { game, en30, it30c };
}

describe("loadPricedCard for a card from another language's catalog", () => {
  it("finds the English card by the TCGdex id the languages share, even inside a merged set", async () => {
    const { game, en30, it30c } = await setup();
    const en = await printing(game.id, en30.id, "Charizard", "001/30", "en", {
      source: "tcgdex-pokemon",
      externalId: "30th-c-001",
    });
    await prisma.providerMapping.create({
      data: { variantId: en.id, provider: "cardmarket", externalId: "907940", confidence: 1, status: "matched" },
    });
    const it = await printing(game.id, it30c.id, "Charizard", "001/30", "it", {
      source: "tcgdex-pokemon-it",
      externalId: "30th-c-001",
    });

    const card = await loadPricedCard(it.id);
    expect(card).toMatchObject({
      setName: "Collzione Classica del 30°",
      setNameAlt: "30th Celebration",
      cardNameAlt: "Charizard",
      // The Italian card had no Cardmarket link of its own: the English one's is used.
      externalIds: { cardmarket: "907940", "tcgdex-pokemon-it": "30th-c-001" },
    });
  });

  it("falls back to the English set with the same code and the same collector number", async () => {
    const { game } = await setup();
    const enSet = await prisma.set.create({ data: { gameId: game.id, code: "sv10.5b", name: "Black Bolt" } });
    const frSet = await prisma.set.create({ data: { gameId: game.id, code: "fr-sv10.5b", name: "Foudre Noire" } });
    await printing(game.id, enSet.id, "Zekrom ex", "034/086", "en");
    const fr = await printing(game.id, frSet.id, "Zekrom-ex", "034/086", "fr");
    expect(await loadPricedCard(fr.id)).toMatchObject({
      cardName: "Zekrom-ex",
      cardNameAlt: "Zekrom ex",
      setNameAlt: "Black Bolt",
    });
  });

  it("does not hand CardTrader its own earlier automatic match as a known id", async () => {
    const { game, en30 } = await setup();
    const en = await printing(game.id, en30.id, "Charizard", "001/30", "en");
    await prisma.providerMapping.create({
      data: { variantId: en.id, provider: "cardtrader", externalId: "1", confidence: 0.9, status: "matched" },
    });
    expect((await loadPricedCard(en.id))!.externalIds.cardtrader).toBeUndefined();
    await prisma.providerMapping.update({
      where: { variantId_provider: { variantId: en.id, provider: "cardtrader" } },
      data: { manualOverride: true },
    });
    expect((await loadPricedCard(en.id))!.externalIds.cardtrader).toBe("1");
  });
});
