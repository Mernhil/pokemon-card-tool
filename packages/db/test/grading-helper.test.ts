import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { gradingCandidates, gradingVerdict } from "../src/grading-helper";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());
beforeEach(resetDb);

describe("gradingVerdict", () => {
  const base = { rawEur: 1000, feeEur: 3000 };
  it("sends when even a 9 pays, gambles when only a 10 does, skips otherwise", () => {
    expect(gradingVerdict({ ...base, tenEur: 20000, nineEur: 6000 }).verdict).toBe("send");
    expect(gradingVerdict({ ...base, tenEur: 8000, nineEur: 3500 }).verdict).toBe("gamble");
    expect(gradingVerdict({ ...base, tenEur: 3000, nineEur: 2000 }).verdict).toBe("skip");
    expect(gradingVerdict({ ...base, tenEur: null, nineEur: null }).verdict).toBe("unknown");
  });
  it("reports the gain after the fee", () => {
    expect(gradingVerdict({ ...base, tenEur: 8000, nineEur: null })).toMatchObject({
      gain10: 4000,
      gain9: null,
    });
  });
});

describe("gradingCandidates", () => {
  it("compares raw value to stored graded prices, converted to EUR", async () => {
    const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokémon" } });
    await prisma.language.create({ data: { code: "en", name: "English" } });
    const set = await prisma.set.create({ data: { gameId: game.id, code: "s1", name: "S" } });
    const card = await prisma.card.create({
      data: { gameId: game.id, name: "Umbreon", cardType: "Pokemon", canonicalKey: "u" },
    });
    const p = await prisma.printing.create({
      data: { cardId: card.id, setId: set.id, collectorNumber: "1", sortNumber: 1 },
    });
    const v = await prisma.printVariant.create({ data: { printingId: p.id, languageCode: "en" } });
    await prisma.collectionItem.create({ data: { variantId: v.id, quantity: 2 } });
    await prisma.collectionItem.create({
      data: { variantId: v.id, quantity: 1, gradingCompany: "PSA", certNumber: "1" },
    });
    await prisma.variantValuation.create({
      data: { variantId: v.id, day: new Date(), bucket: "NM", valueEur: 2000, valueUsd: 2200, confidence: 1 },
    });
    const gp = { variantId: v.id, company: "PSA", currency: "EUR", low: 1, listingCount: 4, languageCode: "en", observedAt: new Date() };
    await prisma.gradedPrice.createMany({
      data: [
        { ...gp, gradeKey: "10", median: 30000 },
        { ...gp, gradeKey: "9", median: 9000 },
      ],
    });
    const [row] = await gradingCandidates("PSA", 25);
    expect(row).toMatchObject({ name: "Umbreon", copies: 2, rawEur: 2000, tenEur: 30000, nineEur: 9000, verdict: "send", gain10: 25500, gain9: 4500 });
    expect(await gradingCandidates("BGS", 25)).toMatchObject([{ verdict: "unknown" }]);
  });
});
