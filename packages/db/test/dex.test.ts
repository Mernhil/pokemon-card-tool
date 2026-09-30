import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { backfillCardDex, dexIdsFromAttributes, findPokemonByName, setCardDex } from "../src/dex";
import { resetDb } from "./helpers";

let n = 0;
async function seed() {
  const game = await prisma.game.upsert({
    where: { slug: "pokemon" },
    update: {},
    create: { slug: "pokemon", name: "Pokémon" },
  });
  const set = await prisma.set.upsert({
    where: { gameId_code: { gameId: game.id, code: "s1" } },
    update: {},
    create: { gameId: game.id, code: "s1", name: "Set" },
  });
  const card = async (name: string, dexId?: number[], cardType = "Pokemon") => {
    const i = ++n;
    const c = await prisma.card.create({
      data: {
        gameId: game.id,
        name,
        cardType,
        canonicalKey: `k${i}`,
        attributes: JSON.stringify(dexId ? { dexId } : {}),
      },
    });
    await prisma.printing.create({
      data: { cardId: c.id, setId: set.id, collectorNumber: `${i}/99`, sortNumber: i },
    });
    return c;
  };
  return { game, card };
}

/** The same filter the search page builds for an exact Pokémon match. */
async function searchByDex(dexId: number) {
  const printings = await prisma.printing.findMany({
    where: { card: { dex: { some: { dexId } }, game: { slug: "pokemon" } } },
    include: { card: true },
  });
  return printings.map((p) => p.card.name).sort();
}

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("dexIdsFromAttributes", () => {
  it("reads TCGdex dexId lists from the attributes JSON", () => {
    expect(dexIdsFromAttributes('{"hp":60,"dexId":[385]}')).toEqual([385]);
    expect(dexIdsFromAttributes({ dexId: [25, 644, 25] })).toEqual([25, 644]);
    expect(dexIdsFromAttributes("{}")).toEqual([]);
    expect(dexIdsFromAttributes("not json")).toEqual([]);
    expect(dexIdsFromAttributes('{"dexId":["x",0,-1]}')).toEqual([]);
  });
});

describe("backfillCardDex", () => {
  it("fills the table from attributes, skips empty lists, and is idempotent", async () => {
    const { card } = await seed();
    await card("Jirachi", [385]);
    await card("Jirachi ex", [385]);
    await card("Tag Team", [25, 644]);
    await card("Broken", []);
    await card("Potion", undefined, "Trainer");

    expect(await backfillCardDex()).toBe(3);
    expect(await prisma.cardDex.count()).toBe(4);
    expect(await backfillCardDex()).toBe(0);
  });

  it("setCardDex keeps the rows in step with a card's current ids", async () => {
    const { card } = await seed();
    const c = await card("Jirachi", [385]);
    await setCardDex(prisma, c.id, [385]);
    await setCardDex(prisma, c.id, [385, 386]);
    expect(
      (await prisma.cardDex.findMany({ where: { cardId: c.id } })).map((r) => r.dexId).sort(),
    ).toEqual([385, 386]);
    await setCardDex(prisma, c.id, [386]);
    expect(
      (await prisma.cardDex.findMany({ where: { cardId: c.id } })).map((r) => r.dexId),
    ).toEqual([386]);
  });
});

describe("exact Pokémon search", () => {
  async function world() {
    const { card } = await seed();
    await card("Jirachi", [385]);
    await card("Jirachi ex", [385]);
    await card("Jirachi V", [385]);
    await card("Mew", [151]);
    await card("Mew ex", [151]);
    await card("Mewtwo", [150]);
    await card("Mewtwo VSTAR", [150]);
    await card("Pikachu & Zekrom GX", [25, 644]);
    await card("Pikachu", [25]);
    await backfillCardDex();
  }

  it("Mew finds Mew and Mew ex, never Mewtwo", async () => {
    await world();
    const match = await findPokemonByName("Mew");
    expect(match).toEqual({ dexId: 151, name: "Mew" });
    expect(await searchByDex(match!.dexId)).toEqual(["Mew", "Mew ex"]);
    // The old contains search is exactly what this avoids.
    const contains = await prisma.card.findMany({ where: { name: { contains: "Mew" } } });
    expect(contains.map((c) => c.name)).toContain("Mewtwo");
  });

  it("Jirachi lists every Jirachi card; matching ignores case", async () => {
    await world();
    const match = await findPokemonByName("jirachi");
    expect(match?.dexId).toBe(385);
    expect(await searchByDex(385)).toEqual(["Jirachi", "Jirachi V", "Jirachi ex"]);
  });

  it("a variant name, a partial name or an unknown name is plain text search", async () => {
    await world();
    expect(await findPokemonByName("Jirachi ex")).toBeNull();
    expect(await findPokemonByName("Jira")).toBeNull();
    expect(await findPokemonByName("Potion")).toBeNull();
    expect(await findPokemonByName("")).toBeNull();
  });

  it("a tag-team card's name is not treated as one Pokémon", async () => {
    await world();
    expect(await findPokemonByName("Pikachu & Zekrom GX")).toBeNull();
    // ...but Pikachu #25 still finds the tag-team card too (it has that dex id).
    expect(await searchByDex(25)).toEqual(["Pikachu", "Pikachu & Zekrom GX"]);
  });
});
