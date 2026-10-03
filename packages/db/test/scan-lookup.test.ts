import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { findScanCandidates } from "../src/scan-lookup";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

async function card(setCode: string, printedTotal: number, name: string, number: string) {
  const game = await prisma.game.upsert({ where: { slug: "pokemon" }, update: {}, create: { slug: "pokemon", name: "Pokémon" } });
  await prisma.language.upsert({ where: { code: "en" }, update: {}, create: { code: "en", name: "English" } });
  const set = await prisma.set.upsert({
    where: { gameId_code: { gameId: game.id, code: setCode } },
    update: {},
    create: { gameId: game.id, code: setCode, name: `Set ${setCode}`, printedTotal },
  });
  const c = await prisma.card.create({ data: { gameId: game.id, name, cardType: "Pokemon", canonicalKey: `${setCode}-${name}` } });
  const p = await prisma.printing.create({ data: { cardId: c.id, setId: set.id, collectorNumber: number, sortNumber: 1 } });
  await prisma.printVariant.create({ data: { printingId: p.id, languageCode: "en" } });
}

describe("findScanCandidates", () => {
  beforeEach(async () => {
    await card("a", 198, "Pikachu", "025/198");
    await card("b", 165, "Raichu", "025/165");
    await card("c", 198, "Other", "125/198");
  });

  it("uses the set total to pick the set", async () => {
    const found = await findScanCandidates([{ number: "025", total: "198" }]);
    expect(found.map((f) => f.name)).toEqual(["Pikachu"]);
    expect(found[0]!.variants).toHaveLength(1);
  });

  it("offers every set with that number when no total was read", async () => {
    const found = await findScanCandidates([{ number: "25", total: null }]);
    expect(found.map((f) => f.name).sort()).toEqual(["Pikachu", "Raichu"]);
    expect(found.every((f) => f.score < 1)).toBe(true);
  });

  it("finds nothing for a number no card has", async () => {
    expect(await findScanCandidates([{ number: "999", total: "198" }])).toEqual([]);
  });
});
