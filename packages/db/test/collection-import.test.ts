import { parseCollectionCsv } from "@tcg-vault/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { commitImport, lookupName, matchImportRows } from "../src/collection-import";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());

async function printing(setCode: string, setName: string, name: string, number: string, finishes: string[]) {
  const game = await prisma.game.upsert({ where: { slug: "pokemon" }, update: {}, create: { slug: "pokemon", name: "Pokémon" } });
  await prisma.language.upsert({ where: { code: "en" }, update: {}, create: { code: "en", name: "English" } });
  const set = await prisma.set.upsert({
    where: { gameId_code: { gameId: game.id, code: setCode } },
    update: {},
    create: { gameId: game.id, code: setCode, name: setName },
  });
  const card =
    (await prisma.card.findFirst({ where: { gameId: game.id, name } })) ??
    (await prisma.card.create({
      data: { gameId: game.id, name, cardType: "Pokemon", canonicalKey: `k-${name}` },
    }));
  const p = await prisma.printing.create({
    data: { cardId: card.id, setId: set.id, collectorNumber: number, sortNumber: Number.parseInt(number) || 1 },
  });
  for (const finish of finishes)
    await prisma.printVariant.create({ data: { printingId: p.id, finish, languageCode: "en" } });
  return p;
}

beforeEach(async () => {
  await resetDb();
  await printing("base1", "Base Set", "Charizard", "4/102", ["HOLO"]);
  await printing("base2", "Jungle", "Pikachu", "60/64", ["NON_FOIL", "REVERSE_HOLO"]);
  await printing("sv3", "Obsidian Flames", "Pikachu", "60/64", ["NON_FOIL", "REVERSE_HOLO"]);
});

describe("lookupName", () => {
  it("drops tags other trackers add to a name", () => {
    expect(lookupName("Charizard - 4/102 (Holo)")).toBe("Charizard");
  });
});

describe("matchImportRows", () => {
  it("matches by set, number and name, and picks the finish from the file", async () => {
    const { rows } = parseCollectionCsv(
      "Name,Set,Number,Foil,Qty\nCharizard,Base Set,4,yes,1\nPikachu,Jungle,60,yes,2\nPikachu,Jungle,60,,1\n",
    );
    const [zard, rev, plain] = await matchImportRows(rows);
    expect(zard).toMatchObject({ status: "matched" });
    expect(zard!.candidates[0]).toMatchObject({ setCode: "base1", finish: "HOLO" });
    expect(rev!.candidates[0]).toMatchObject({ setCode: "base2", finish: "REVERSE_HOLO" });
    expect(rev!.status).toBe("matched");
    expect(plain!.candidates[0]!.finish).toBe("NON_FOIL");
  });

  it("asks for review when the same number exists in two sets and the file names none", async () => {
    const { rows } = parseCollectionCsv("Name,Number\nPikachu,60/64\n");
    const [r] = await matchImportRows(rows);
    expect(r!.status).toBe("review");
    expect(r!.candidates.map((c) => c.setCode).sort()).toEqual(["base2", "sv3"]);
  });

  it("finds nothing for an unknown card or a wrong number", async () => {
    const { rows } = parseCollectionCsv("Name,Set,Number\nMissingno,Base Set,1\nCharizard,Base Set,99\n");
    expect((await matchImportRows(rows)).map((r) => r.status)).toEqual(["none", "none"]);
  });
});

describe("commitImport", () => {
  it("adds the chosen rows with condition and price", async () => {
    const { rows } = parseCollectionCsv("Name,Set,Number,Qty,Condition,Price\nCharizard,Base Set,4,2,LP,12.5\n");
    const [m] = await matchImportRows(rows);
    const copies = await commitImport([
      { variantId: m!.candidates[0]!.variantId, quantity: 2, condition: "LIGHTLY_PLAYED", paid: 12.5 },
    ]);
    expect(copies).toBe(2);
    const item = await prisma.collectionItem.findFirstOrThrow();
    expect(item).toMatchObject({ quantity: 2, condition: "LIGHTLY_PLAYED", purchasePrice: 1250, purchaseCurrency: "EUR" });
  });
});
