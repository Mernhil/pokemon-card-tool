import type { PriceProviderId } from "@tcg-vault/shared";
import { pointsForLanguage, type PricePoint } from "@tcg-vault/pricing";
import type { ProviderObservation } from "@tcg-vault/sources";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import {
  enqueueLanguagePrices,
  parsePriceItemKey,
  priceItemKey,
  priceJob,
} from "../src/price-refresh";
import { normalizeObservation, pricePoints, recordObservations } from "../src/prices";
import { defaultSettings, getSettings, sanitizeSettings, updateSettings } from "../src/settings";
import { computeValuations, latestValuations, valueFromPoints } from "../src/valuations";
import { fakeClock, resetDb } from "./helpers";

const rates = { base: "EUR", source: "builtin", asOf: "", rates: { EUR: 1, USD: 1.25 } } as never;
const at = new Date("2026-09-10T10:00:00Z");

const pt = (
  provider: string,
  kind: PricePoint["kind"],
  amount: number,
  extra: Partial<PricePoint> = {},
): PricePoint => ({
  provider,
  kind,
  amount,
  currency: "EUR",
  condition: "NEAR_MINT",
  listingCount: 3,
  languageCode: null,
  observedAt: at,
  ...extra,
});

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("pointsForLanguage", () => {
  const points = [
    pt("cardtrader", "lowest_listing", 100, { languageCode: "de" }),
    pt("cardtrader", "lowest_listing", 900, { languageCode: "en" }),
    pt("cardmarket", "trend", 1000, { condition: null }),
    pt("ebay", "asking", 700),
  ];

  it("language-aware providers give the requested language only", () => {
    expect(pointsForLanguage("cardtrader", points, "en")).toMatchObject({
      mode: "language",
      points: [{ amount: 900 }],
    });
    expect(pointsForLanguage("cardtrader", points, "de").points[0]!.amount).toBe(100);
  });

  it("providers that can not split say so; unlabelled numbers are flagged; other languages are never used", () => {
    expect(pointsForLanguage("cardmarket", points, "de").mode).toBe("all-languages");
    expect(pointsForLanguage("ebay", points, "en").mode).toBe("unsplit");
    expect(pointsForLanguage("cardtrader", points, "fr")).toEqual({
      points: [],
      mode: "other-languages",
    });
    expect(pointsForLanguage("tcgplayer", points, "en").mode).toBe("none");
  });
});

describe("value anchor with mixed-language data", () => {
  it("a cheap German listing does not drag the English value down", () => {
    const points = [
      pt("cardtrader", "lowest_listing", 100, { languageCode: "de" }), // the trap
      pt("cardtrader", "lowest_listing", 900, { languageCode: "en" }),
      pt("cardmarket", "trend", 1000, { condition: null }),
    ];
    const en = valueFromPoints(points, rates, new Set(), "en")!;
    expect(en.valueEur).toBeGreaterThanOrEqual(900);
    expect(en.valueEur).toBeLessThanOrEqual(1000);
    expect(en.mixedOnly).toBe(false);
    // The German value is the German number (plus the unsplit Cardmarket one).
    expect(valueFromPoints(points, rates, new Set(), "de")!.valueEur).toBeLessThanOrEqual(en.valueEur);
  });

  it("numbers in other languages are never used when the requested one is missing", () => {
    const points = [pt("cardtrader", "lowest_listing", 100, { languageCode: "de" })];
    expect(valueFromPoints(points, rates, new Set(), "en")).toBeNull();
  });

  it("falls back to unlabelled numbers, with mixedOnly set", () => {
    const points = [pt("ebay", "asking", 800)];
    expect(valueFromPoints(points, rates, new Set(), "en")).toMatchObject({
      valueEur: 800,
      mixedOnly: true,
    });
  });

  it("unlabelled CardTrader listings beat Cardmarket's trend", () => {
    const points = [
      pt("cardtrader", "lowest_listing", 7463),
      pt("cardtrader", "lowest_avg", 7600),
      pt("cardmarket", "trend", 8627, { condition: null }),
    ];
    expect(valueFromPoints(points, rates, new Set(), "it")!.valueEur).toBe(7600);
  });

  it("never uses Cardmarket's lowest listing as a headline or anchor input", () => {
    const onlyLow = [pt("cardmarket", "lowest_listing", 50, { condition: null })];
    expect(valueFromPoints(onlyLow, rates, new Set(), "en")).toBeNull();
    const withTrend = [...onlyLow, pt("cardmarket", "trend", 1000, { condition: null })];
    expect(valueFromPoints(withTrend, rates, new Set(), "en")!.valueEur).toBe(1000);
  });
});

async function makeVariant(languageCode = "en") {
  const game = await prisma.game.upsert({
    where: { slug: "pokemon" },
    update: {},
    create: { slug: "pokemon", name: "Pokémon" },
  });
  for (const code of new Set(["en", languageCode]))
    await prisma.language.upsert({ where: { code }, update: {}, create: { code, name: code } });
  const set = await prisma.set.create({ data: { gameId: game.id, code: "s1", name: "Set" } });
  const card = await prisma.card.create({
    data: { gameId: game.id, name: "Jirachi", cardType: "Pokemon", canonicalKey: "jirachi" },
  });
  const printing = await prisma.printing.create({
    data: { cardId: card.id, setId: set.id, collectorNumber: "001/100", sortNumber: 1 },
  });
  return prisma.printVariant.create({ data: { printingId: printing.id, languageCode } });
}

const obs = (
  amount: number,
  languageCode: string | null,
  extra: Partial<ProviderObservation> = {},
): ProviderObservation => ({
  kind: "lowest_listing",
  amount,
  currency: "EUR",
  condition: "NEAR_MINT",
  listingCount: 2,
  languageCode,
  observedAt: new Date(),
  payloadHash: null,
  ...extra,
});

describe("storing and reading language", () => {
  it("keeps one observation set per language, and reads it back", async () => {
    const v = await makeVariant();
    const when = new Date();
    await recordObservations(v.id, "cardtrader", [
      obs(100, "de", { observedAt: when }),
      obs(900, "en", { observedAt: when }),
    ]);
    // Same second refresh: no duplicates, per language.
    expect(
      await recordObservations(v.id, "cardtrader", [obs(900, "en", { observedAt: when })]),
    ).toBe(0);
    const rows = await prisma.priceObservation.findMany({ orderBy: { amount: "asc" } });
    expect(rows.map((r) => [r.languageCode, r.amount])).toEqual([
      ["de", 100],
      ["en", 900],
    ]);
    const points = (await pricePoints([v.id])).get(v.id)!;
    expect(points.map((p) => p.languageCode).sort()).toEqual(["de", "en"]);
  });

  it("normalizeObservation carries the language, and legacy rows have none", () => {
    const row = {
      id: 1,
      variantId: "v",
      source: "CARDTRADER",
      provider: "cardtrader",
      kind: "lowest_listing",
      amount: 900,
      condition: "NEAR_MINT",
      gradingCompany: null,
      grade: null,
      currency: "EUR",
      low: null,
      mid: null,
      market: null,
      trend: null,
      sampleSize: null,
      listingCount: 2,
      languageCode: "en",
      payloadHash: null,
      observedAt: at,
    };
    expect(normalizeObservation(row)[0]!.languageCode).toBe("en");
    expect(normalizeObservation({ ...row, languageCode: null })[0]!.languageCode).toBeNull();
  });

  it("values follow the price language, and confidence drops when only mixed data exists", async () => {
    const v = await makeVariant();
    const now = new Date();
    await recordObservations(v.id, "cardtrader", [obs(100, "de"), obs(900, "en")]);
    await recordObservations(v.id, "cardmarket", [
      obs(1000, null, { kind: "trend", condition: null }),
      obs(50, null, { kind: "lowest_listing", condition: null }),
    ]);
    await computeValuations(now, "en");
    const en = (await latestValuations([v.id])).get(v.id)!;
    expect(en.valueEur).toBeGreaterThanOrEqual(900);
    const row = await prisma.variantValuation.findFirstOrThrow({ where: { variantId: v.id } });
    expect(row.confidence).toBe(1);

    // Switching to a language with no data: CardTrader has nothing usable, Cardmarket is mixed.
    await computeValuations(now, "fr");
    const fr = await prisma.variantValuation.findFirstOrThrow({ where: { variantId: v.id } });
    expect(fr.valueEur).toBe(1000);
    expect(fr.confidence).toBeCloseTo(0.3); // one mixed source: 0.5 * 0.6

    // A language nothing can price removes today's value instead of keeping the old number.
    await prisma.priceObservation.deleteMany({ where: { provider: "cardmarket" } });
    await computeValuations(now, "fr");
    expect(await prisma.variantValuation.count({ where: { variantId: v.id } })).toBe(0);
  });
});

describe("a value never lags behind the prices next to it", () => {
  it("revaluing one card replaces a trend-only value with its listings, and says where it came from", async () => {
    const v = await makeVariant();
    const other = await prisma.printVariant.create({
      data: { printingId: v.printingId, languageCode: "en", finish: "HOLO" },
    });
    const now = new Date();
    await recordObservations(v.id, "cardmarket", [obs(10534, null, { kind: "trend", condition: null })]);
    await recordObservations(other.id, "cardmarket", [obs(500, null, { kind: "trend", condition: null })]);
    await computeValuations(now, "en");
    expect((await latestValuations([v.id])).get(v.id)!.valueEur).toBe(10534);

    // CardTrader listings arrive after that run.
    await recordObservations(v.id, "cardtrader", [
      obs(6890, "en", { observedAt: now }),
      obs(6950, "en", { kind: "lowest_avg", listingCount: 5, observedAt: now }),
    ]);
    await prisma.priceObservation.deleteMany({ where: { variantId: other.id } });
    expect(await computeValuations(now, "en", { variantIds: [v.id] })).toBe(1);
    expect((await latestValuations([v.id])).get(v.id)!.valueEur).toBe(6950);
    // Only the asked-for card was touched: the other keeps today's row.
    expect((await latestValuations([other.id])).get(other.id)!.valueEur).toBe(500);
    // Nothing changed: nothing is written again.
    expect(await computeValuations(now, "en", { variantIds: [v.id] })).toBe(0);
  });

  it("valueFromPoints names the providers the value came from", () => {
    const points = [
      pt("cardmarket", "trend", 10534, { condition: null }),
      pt("cardtrader", "lowest_listing", 6890, { languageCode: "it" }),
    ];
    expect(valueFromPoints(points, rates, new Set(), "it")!.providers).toEqual(["cardtrader"]);
    expect(valueFromPoints(points.slice(0, 1), rates, new Set(), "it")!.providers).toEqual(["cardmarket"]);
  });
});

describe("price language setting", () => {
  it("defaults to English, round-trips, and ignores garbage", async () => {
    expect((await getSettings()).priceLanguage).toBe("en");
    expect((await updateSettings({ priceLanguage: "de" })).priceLanguage).toBe("de");
    expect((await getSettings()).priceLanguage).toBe("de");
    expect((await updateSettings({ priceLanguage: "klingon" })).priceLanguage).toBe("de");
    expect(sanitizeSettings({ priceLanguage: "zh-Hant" }).priceLanguage).toBe("zh-Hant");
    expect(sanitizeSettings({ priceLanguage: 5 }).priceLanguage).toBe(
      defaultSettings().priceLanguage,
    );
  });
});

describe("on-demand language lookups", () => {
  it("item keys carry the language", () => {
    expect(priceItemKey("abc")).toBe("abc");
    expect(priceItemKey("abc", "de")).toBe("abc@de");
    expect(parsePriceItemKey("abc@de")).toEqual({ variantId: "abc", language: "de" });
    expect(parsePriceItemKey("abc")).toEqual({ variantId: "abc", language: null });
  });

  it("queues only eBay, once, and not again within the freshness window", async () => {
    const v = await makeVariant();
    const clock = fakeClock();
    const args: [string[], string, string, PriceProviderId[]] = [
      [v.id],
      "pokemon",
      "de",
      ["cardtrader", "ebay", "cardmarket"],
    ];
    expect(await enqueueLanguagePrices(...args, { now: clock.now() })).toBe(true);
    const rows = await prisma.syncState.findMany();
    expect(rows.map((r) => [r.job, r.itemKey])).toEqual([[priceJob("ebay"), `${v.id}@de`]]);
    // Already queued: nothing new (the eBay call budget is not spent on every page view).
    expect(await enqueueLanguagePrices(...args, { now: clock.now() })).toBe(false);
    await prisma.syncState.updateMany({
      data: { status: "done", lastSyncedAt: clock.now() },
    });
    expect(await enqueueLanguagePrices(...args, { now: clock.now() })).toBe(false);
    clock.advance(25 * 3_600_000);
    expect(await enqueueLanguagePrices(...args, { now: clock.now() })).toBe(true);
    expect(await enqueueLanguagePrices([v.id], "pokemon", "de", ["cardtrader"])).toBe(false);
  });
});

describe("listing-first value", () => {
  it("an Italian near-mint listing at 60 beats a Cardmarket trend of 105 that mixes every language", () => {
    const points = [
      pt("cardtrader", "lowest_listing", 6000, { languageCode: "it" }),
      pt("cardtrader", "lowest_5th", 6500, { languageCode: "it" }),
      pt("cardmarket", "trend", 10534, { condition: null }),
    ];
    const v = valueFromPoints(points, rates, new Set(), "it")!;
    expect(v.valueEur).toBe(6000);
    expect(v.mixedOnly).toBe(false);
  });

  it("falls back to the Cardmarket trend when no listing exists in that language", () => {
    const points = [pt("cardmarket", "trend", 10534, { condition: null })];
    expect(valueFromPoints(points, rates, new Set(), "it")!.valueEur).toBe(10534);
  });
});

describe("value from the average of the cheapest near-mint listings", () => {
  it("uses lowest_avg instead of the single cheapest or the Cardmarket trend", () => {
    const points = [
      pt("cardtrader", "lowest_listing", 6899, { languageCode: "it" }),
      pt("cardtrader", "lowest_avg", 7010, { languageCode: "it", listingCount: 5 }),
      pt("cardtrader", "lowest_5th", 7379, { languageCode: "it" }),
      pt("cardmarket", "trend", 10534, { condition: null }),
    ];
    expect(valueFromPoints(points, rates, new Set(), "it")!.valueEur).toBe(7010);
  });
  it("uses the cheapest listing when there were too few to average", () => {
    const points = [
      pt("cardtrader", "lowest_listing", 6899, { languageCode: "it" }),
      pt("cardmarket", "trend", 10534, { condition: null }),
    ];
    expect(valueFromPoints(points, rates, new Set(), "it")!.valueEur).toBe(6899);
  });
  it("ignores an average dearer than the 5th cheapest listing", () => {
    // Stored before the fix: two ~€10k listings averaged, above five cheaper ones.
    const points = [
      pt("cardtrader", "lowest_listing", 20064, { languageCode: null }),
      pt("cardtrader", "lowest_avg", 1003427, { languageCode: null, listingCount: 2 }),
      pt("cardtrader", "lowest_5th", 200064, { languageCode: null }),
      pt("cardmarket", "trend", 21376, { condition: null }),
    ];
    expect(valueFromPoints(points, rates, new Set(), "en")!.valueEur).toBe(20064);
  });
});

describe("a card is valued in its own language", () => {
  it("an Italian card is valued from Italian listings even when the price language is English", async () => {
    const v = await makeVariant("it");
    await recordObservations(v.id, "cardtrader", [
      obs(6899, "it"),
      obs(6930, "it", { kind: "lowest_avg", listingCount: 4 }),
      obs(7554, "en"),
      obs(8227, "en", { kind: "lowest_avg", listingCount: 3 }),
    ]);
    await recordObservations(v.id, "cardmarket", [obs(10534, null, { kind: "trend", condition: null })]);
    await computeValuations(new Date());
    expect((await latestValuations([v.id])).get(v.id)!.valueEur).toBe(6930);
  });
});
