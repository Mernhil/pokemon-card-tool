import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { priceRefreshItems } from "../src/price-refresh";
import { setWishlistTarget, wishlistDeals } from "../src/wishlist-deals";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

async function wished(target: number | null) {
  const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokémon" } });
  await prisma.language.create({ data: { code: "en", name: "English" } });
  const set = await prisma.set.create({ data: { gameId: game.id, code: "s1", name: "S" } });
  const card = await prisma.card.create({
    data: { gameId: game.id, name: "Gengar", cardType: "Pokemon", canonicalKey: "g" },
  });
  const p = await prisma.printing.create({
    data: { cardId: card.id, setId: set.id, collectorNumber: "1", sortNumber: 1 },
  });
  const v = await prisma.printVariant.create({ data: { printingId: p.id, languageCode: "en" } });
  await prisma.wishlistItem.create({ data: { printingId: p.id } });
  if (target !== null) await setWishlistTarget(p.id, target);
  return { printingId: p.id, variantId: v.id };
}

const listing = (variantId: string, provider: string, amount: number, currency = "EUR", ageDays = 0) =>
  prisma.priceObservation.create({
    data: {
      variantId,
      source: "t",
      provider,
      kind: "lowest_listing",
      amount,
      currency,
      observedAt: new Date(Date.now() - ageDays * 86_400_000),
    },
  });

describe("wishlist deals", () => {
  it("flags a card whose cheapest recent listing is at or under the target", async () => {
    const { printingId, variantId } = await wished(10);
    await listing(variantId, "cardtrader", 1200);
    await listing(variantId, "ebay", 950);
    const deal = (await wishlistDeals()).get(printingId)!;
    expect(deal).toMatchObject({ lowestEur: 950, provider: "ebay", hit: true, targetEur: 1000 });
  });

  it("doesn't flag above the target, or on old or superseded listings", async () => {
    const { printingId, variantId } = await wished(10);
    await listing(variantId, "ebay", 500, "EUR", 30); // too old
    expect((await wishlistDeals()).get(printingId)).toMatchObject({ lowestEur: null, hit: false });
    await listing(variantId, "ebay", 800, "EUR", 2); // older cheap listing...
    await listing(variantId, "ebay", 1500, "EUR", 0); // ...replaced by a newer, dearer one
    expect((await wishlistDeals()).get(printingId)).toMatchObject({ lowestEur: 1500, hit: false });
  });

  it("ignores cards without a target, and refuses a zero target", async () => {
    const { printingId } = await wished(null);
    expect((await wishlistDeals()).size).toBe(0);
    await expect(setWishlistTarget(printingId, 0)).rejects.toThrow(/above 0/);
  });

  it("keeps cards with a target on the price refresh list", async () => {
    const { variantId } = await wished(5);
    expect((await priceRefreshItems("pokemon")).map((i) => i.key)).toContain(variantId);
  });
});
