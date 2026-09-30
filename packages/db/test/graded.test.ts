import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { loadGradedPrices, refreshGradedPrices } from "../src/graded";
import { resetDb } from "./helpers";

async function makeVariant() {
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
  const set = await prisma.set.create({ data: { gameId: game.id, code: "g1", name: "G" } });
  const card = await prisma.card.create({
    data: { gameId: game.id, name: "Mew", cardType: "Pokemon", canonicalKey: "mew-g1" },
  });
  const printing = await prisma.printing.create({
    data: { cardId: card.id, setId: set.id, collectorNumber: "001/10", sortNumber: 1 },
  });
  const variant = await prisma.printVariant.create({
    data: { printingId: printing.id, languageCode: "en" },
  });
  return variant.id;
}

beforeEach(resetDb);

const obs = (company: string, gradeKey: string, median: number) => ({
  company: company as "PSA",
  gradeKey,
  currency: "USD",
  median,
  low: median - 100,
  listingCount: 2,
  languageCode: "en",
});

describe("graded prices", () => {
  it("stores a lookup and replaces the previous one on the next", async () => {
    const variantId = await makeVariant();
    const first = await refreshGradedPrices(
      { fetchGradedPrices: async () => [obs("PSA", "10", 10_000), obs("PSA", "9", 4_000)] },
      variantId,
      "en",
    );
    expect(first).toBe(2);
    expect((await loadGradedPrices(variantId, "en")).map((r) => r.gradeKey).sort()).toEqual([
      "10",
      "9",
    ]);

    await refreshGradedPrices(
      { fetchGradedPrices: async () => [obs("CGC", "10:pristine", 20_000)] },
      variantId,
      "en",
    );
    const rows = await loadGradedPrices(variantId, "en");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company: "CGC", gradeKey: "10:pristine", median: 20_000 });
  });

  it("an empty lookup clears old rows, and a failed one keeps them", async () => {
    const variantId = await makeVariant();
    await refreshGradedPrices(
      { fetchGradedPrices: async () => [obs("PSA", "10", 1_000)] },
      variantId,
      "en",
    );
    await expect(
      refreshGradedPrices(
        {
          fetchGradedPrices: async () => {
            throw new Error("rate limited");
          },
        },
        variantId,
        "en",
      ),
    ).rejects.toThrow("rate limited");
    expect(await loadGradedPrices(variantId, "en")).toHaveLength(1);

    await refreshGradedPrices({ fetchGradedPrices: async () => [] }, variantId, "en");
    expect(await loadGradedPrices(variantId, "en")).toHaveLength(0);
  });
});
