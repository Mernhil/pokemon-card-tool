import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import {
  createGoal,
  goalProgress,
  goalSearchParams,
  listGoals,
  sanitizeGoalFilter,
} from "../src/goals";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

async function seed() {
  const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokémon" } });
  await prisma.language.createMany({ data: [{ code: "en", name: "English" }, { code: "ja", name: "Japanese" }] });
  const set = await prisma.set.create({ data: { gameId: game.id, code: "s1", name: "S" } });
  let n = 0;
  const make = async (name: string, lang = "en", finish = "NON_FOIL") => {
    const i = ++n;
    const card = await prisma.card.create({
      data: { gameId: game.id, name, cardType: "Pokemon", canonicalKey: `k${i}` },
    });
    const p = await prisma.printing.create({
      data: { cardId: card.id, setId: set.id, collectorNumber: `${i}`, sortNumber: i },
    });
    return prisma.printVariant.create({ data: { printingId: p.id, languageCode: lang, finish } });
  };
  return { make, set };
}

describe("goals", () => {
  it("counts matching cards and the ones you own", async () => {
    const { make } = await seed();
    const a = await make("Charizard");
    await make("Charizard ex");
    await make("Pikachu");
    await prisma.collectionItem.create({ data: { variantId: a.id, quantity: 1 } });
    const goal = await createGoal("All Charizards", { q: "Charizard", plainText: true, lang: "en" });
    expect(await goalProgress(goal)).toMatchObject({ name: "All Charizards", total: 2, owned: 1 });
    expect((await listGoals()).map((g) => g.name)).toEqual(["All Charizards"]);
  });

  it("only counts copies in the goal's language and finish", async () => {
    const { make } = await seed();
    const ja = await make("Eevee", "ja");
    await make("Eevee", "en");
    await prisma.collectionItem.create({ data: { variantId: ja.id, quantity: 1 } });
    const en = await createGoal("English Eevee", { q: "Eevee", plainText: true, lang: "en" });
    expect(await goalProgress(en)).toMatchObject({ total: 1, owned: 0 });
    const any = await createGoal("Any Eevee", { q: "Eevee", plainText: true });
    expect(await goalProgress(any)).toMatchObject({ total: 2, owned: 1 });
  });

  it("rejects empty goals and cleans stored filters", async () => {
    await expect(createGoal("", { q: "x" })).rejects.toThrow(/name/);
    await expect(createGoal("Nothing", {})).rejects.toThrow(/filter/);
    expect(sanitizeGoalFilter({ q: " Mew ", set: "3", rarity: 2, tier: "nope", junk: 1 })).toEqual({
      q: "Mew",
      rarity: 2,
    });
    expect(goalSearchParams({ q: "Mew", lang: "en" })).toBe("q=Mew&lang=en&sort=number");
  });
});
