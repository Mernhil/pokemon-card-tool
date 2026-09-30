import { beforeEach, describe, expect, it } from "vitest";
import { alertCrossed, createAlert, evaluateAlerts, listAlerts } from "../src/alerts";
import { prisma } from "../src/client";
import { resetDb } from "./helpers";

describe("alertCrossed", () => {
  it("ABOVE fires at or over the threshold, BELOW at or under", () => {
    expect(alertCrossed("ABOVE", 500, 500)).toBe(true);
    expect(alertCrossed("ABOVE", 500, 499)).toBe(false);
    expect(alertCrossed("BELOW", 500, 500)).toBe(true);
    expect(alertCrossed("BELOW", 500, 501)).toBe(false);
  });
  it("never fires without a value", () => {
    expect(alertCrossed("ABOVE", 1, null)).toBe(false);
    expect(alertCrossed("BELOW", 1000, undefined)).toBe(false);
  });
});

async function makeVariant(valueEur: number | null) {
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
  const set = await prisma.set.create({ data: { gameId: game.id, code: "a1", name: "Set A" } });
  const card = await prisma.card.create({
    data: { gameId: game.id, name: "Mew", cardType: "Pokemon", canonicalKey: "mew-a1" },
  });
  const printing = await prisma.printing.create({
    data: { cardId: card.id, setId: set.id, collectorNumber: "001/10", sortNumber: 1 },
  });
  const variant = await prisma.printVariant.create({
    data: { printingId: printing.id, languageCode: "en" },
  });
  if (valueEur !== null) {
    await prisma.variantValuation.create({
      data: {
        variantId: variant.id,
        day: new Date("2026-10-01T00:00:00Z"),
        bucket: "NM",
        valueEur,
        valueUsd: valueEur,
        confidence: 1,
      },
    });
  }
  return variant.id;
}

beforeEach(resetDb);

describe("evaluateAlerts", () => {
  it("fires only alerts whose threshold was crossed, once", async () => {
    const variantId = await makeVariant(1200);
    const above = await createAlert({ variantId, direction: "ABOVE", thresholdEur: 1000 });
    const farAbove = await createAlert({ variantId, direction: "ABOVE", thresholdEur: 5000 });
    const below = await createAlert({ variantId, direction: "BELOW", thresholdEur: 800 });

    expect(await evaluateAlerts(new Date("2026-10-01T10:00:00Z"))).toBe(1);
    expect(await evaluateAlerts()).toBe(0); // already fired

    const rows = await listAlerts([variantId]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[above.id]!.triggeredAt).not.toBeNull();
    expect(byId[above.id]!.triggeredValueEur).toBe(1200);
    expect(byId[farAbove.id]!.triggeredAt).toBeNull();
    expect(byId[below.id]!.triggeredAt).toBeNull();
    expect(rows[0]!.id).toBe(above.id); // triggered first
  });

  it("does nothing for a card with no valuation yet", async () => {
    const variantId = await makeVariant(null);
    await createAlert({ variantId, direction: "BELOW", thresholdEur: 100 });
    expect(await evaluateAlerts()).toBe(0);
  });

  it("rejects a bad price or direction", async () => {
    const variantId = await makeVariant(100);
    await expect(createAlert({ variantId, direction: "ABOVE", thresholdEur: 0 })).rejects.toThrow();
    await expect(
      createAlert({ variantId, direction: "SIDEWAYS" as never, thresholdEur: 5 }),
    ).rejects.toThrow();
  });
});
