import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { generationOf, livingPokedex, pokemonNameFrom } from "../src/pokedex";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

describe("helpers", () => {
  it("names a Pokémon by its plainest Latin card name", () => {
    expect(pokemonNameFrom(["Pikachu V", "Pikachu", "ピカチュウ"])).toBe("Pikachu");
    expect(pokemonNameFrom(["ピカチュウ"])).toBe("ピカチュウ");
    expect(pokemonNameFrom([])).toBeNull();
  });
  it("places dex ids in generations", () => {
    expect([1, 151, 152, 1025, 1100].map(generationOf)).toEqual([1, 1, 2, 9, 9]);
  });
});

describe("livingPokedex", () => {
  it("counts a Pokémon once any card of it is owned, tag-team cards for both", async () => {
    const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokémon" } });
    await prisma.language.create({ data: { code: "en", name: "English" } });
    const set = await prisma.set.create({ data: { gameId: game.id, code: "s1", name: "S" } });
    let n = 0;
    const make = async (name: string, dex: number[]) => {
      const i = ++n;
      const card = await prisma.card.create({
        data: { gameId: game.id, name, cardType: "Pokemon", canonicalKey: `k${i}` },
      });
      await prisma.cardDex.createMany({ data: dex.map((dexId) => ({ cardId: card.id, dexId })) });
      const p = await prisma.printing.create({
        data: { cardId: card.id, setId: set.id, collectorNumber: `${i}`, sortNumber: i },
      });
      return prisma.printVariant.create({ data: { printingId: p.id, languageCode: "en" } });
    };
    await make("Bulbasaur", [1]);
    const pika = await make("Pikachu", [25]);
    await make("Pikachu V", [25]);
    const duo = await make("Pikachu & Zekrom-GX", [25, 644]);
    await make("Chikorita", [152]);
    await prisma.collectionItem.create({ data: { variantId: pika.id, quantity: 2 } });
    await prisma.collectionItem.create({ data: { variantId: duo.id, quantity: 1 } });

    const dex = await livingPokedex();
    const all = dex.generations.flatMap((g) => g.entries);
    expect(all.map((e) => [e.dexId, e.name, e.copies])).toEqual([
      [1, "Bulbasaur", 0],
      [25, "Pikachu", 3],
      [152, "Chikorita", 0],
      [644, "#644", 1],
    ]);
    expect(dex.owned).toBe(2);
    expect(dex.total).toBe(4);
    expect(dex.generations[0]!.owned).toBe(1);
    expect(dex.generations[4]!.entries.map((e) => e.dexId)).toEqual([644]);
    expect(all.find((e) => e.dexId === 25)!.sample?.cardName).toBe("Pikachu");
  });
});
