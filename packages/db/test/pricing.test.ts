import type {
  PriceProvider,
  PricedCard,
  ProviderObservation,
  ResolvedMapping,
} from "@tcg-vault/sources";
import { RateLimitedError, AuthError } from "@tcg-vault/sources";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/client";
import { loadFxRates, parseEcbXml, refreshFxRates } from "../src/fx";
import {
  PRICE_PRIORITY,
  cleanupPriceQueue,
  enqueuePriceRefresh,
  enqueueStalePrices,
  priceJob,
  priceRefreshItems,
  pricesUpdating,
  recordCardView,
  runPriceRefresh,
  runnableProviders,
} from "../src/price-refresh";
import { normalizeObservation, pricePoints, recordPrices } from "../src/prices";
import {
  computeValuations,
  latestValuations,
  snapshotPortfolio,
  valueFromPoints,
} from "../src/valuations";
import { fakeClock, resetDb } from "./helpers";

const HOUR = 3_600_000;

/** A scripted provider: `behaviour` decides per variant what fetchPrices does. */
function fakeProvider(
  id: "cardtrader" | "ebay" | "cardmarket" | "tcgplayer",
  behaviour: (card: PricedCard, call: number) => ProviderObservation[] | Error = () => [],
  mapping: Partial<ResolvedMapping> = {},
): PriceProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    label: id,
    calls,
    capabilities: {
      supportsSold: false,
      supportsHistory: false,
      kinds: ["lowest_listing"],
      rateLimit: { requests: 1, perMs: 1, note: "" },
      needsCredentials: false,
      games: ["pokemon"],
    },
    isConfigured: () => true,
    resolveMapping: async () => ({
      externalId: "ext-1",
      query: null,
      url: null,
      confidence: 1,
      status: "matched",
      notes: "test",
      ...mapping,
    }),
    fetchPrices: async (card) => {
      calls.push(card.variantId);
      const result = behaviour(card, calls.length);
      if (result instanceof Error) throw result;
      return result;
    },
    testConnection: async () => ({ ok: true, message: "ok" }),
  };
}

const obs = (amount: number, extra: Partial<ProviderObservation> = {}): ProviderObservation => ({
  kind: "lowest_listing",
  amount,
  currency: "EUR",
  condition: "NEAR_MINT",
  listingCount: 3,
  observedAt: new Date(),
  payloadHash: null,
  ...extra,
});

let n = 0;
/** A printing with one NON_FOIL variant; returns ids. */
async function makeCard(name: string, { owned = false } = {}) {
  const i = ++n;
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
  const set = await prisma.set.upsert({
    where: { gameId_code: { gameId: game.id, code: "sv1" } },
    update: {},
    create: { gameId: game.id, code: "sv1", name: "Scarlet & Violet", printedTotal: 198 },
  });
  const card = await prisma.card.create({
    data: { gameId: game.id, name, cardType: "Pokemon", canonicalKey: `k${i}` },
  });
  const printing = await prisma.printing.create({
    data: {
      cardId: card.id,
      setId: set.id,
      collectorNumber: `${String(i).padStart(3, "0")}/198`,
      sortNumber: i,
    },
  });
  const variant = await prisma.printVariant.create({
    data: { printingId: printing.id, languageCode: "en" },
  });
  if (owned) {
    await prisma.collectionItem.create({
      data: { variantId: variant.id, quantity: 2, purchasePrice: 500, purchaseCurrency: "EUR" },
    });
  }
  return { printingId: printing.id, variantId: variant.id };
}

describe("\"Updating…\" never gets stuck", () => {
  const enabled = {
    cardmarket: { enabled: true },
    tcgplayer: { enabled: true },
    cardtrader: { enabled: true },
    ebay: { enabled: false },
  };
  const all = () => ({
    cardmarket: fakeProvider("cardmarket"),
    tcgplayer: fakeProvider("tcgplayer"),
    cardtrader: { ...fakeProvider("cardtrader"), isConfigured: () => false },
    ebay: fakeProvider("ebay"),
  });

  it("runnable = enabled AND configured AND supports the game", () => {
    const providers = all();
    expect(runnableProviders("pokemon", providers, enabled)).toEqual(["cardmarket", "tcgplayer"]);
    expect(runnableProviders("yugioh", providers, enabled)).toEqual([]);
  });

  it("rows queued for a provider that can't run don't count, and are cleaned up", async () => {
    const { variantId } = await makeCard("A", { owned: true });
    // The old behaviour: queue for every provider, including unconfigured ones.
    await enqueuePriceRefresh([variantId], "pokemon");
    const runnable = runnableProviders("pokemon", all(), enabled);
    expect(await pricesUpdating([variantId], { game: "pokemon", providers: runnable })).toBe(true);

    // Only the runnable providers finish; cardtrader/ebay rows stay pending.
    for (const id of runnable) {
      await prisma.syncState.updateMany({ where: { job: priceJob(id) }, data: { status: "done" } });
    }
    expect(await pricesUpdating([variantId], { game: "pokemon", providers: runnable })).toBe(false);

    expect(await cleanupPriceQueue(() => runnable)).toBe(2);
    expect(await prisma.syncState.findMany({ where: { status: "pending" } })).toEqual([]);
  });

  it("enqueues only the given providers", async () => {
    const { variantId } = await makeCard("A");
    await enqueuePriceRefresh([variantId], "pokemon", ["cardmarket"]);
    const rows = await prisma.syncState.findMany();
    expect(rows.map((r) => r.job)).toEqual([priceJob("cardmarket")]);
  });

  it("ignores stale queued/running rows, and re-queues dead syncing ones", async () => {
    const { variantId } = await makeCard("A");
    await enqueuePriceRefresh([variantId], "pokemon", ["cardmarket"]);
    const opts = { game: "pokemon", providers: ["cardmarket" as const] };
    expect(await pricesUpdating([variantId], opts)).toBe(true);
    // 11 minutes later the row is considered dead, not "updating".
    const later = new Date(Date.now() + 11 * 60_000);
    expect(await pricesUpdating([variantId], { ...opts, now: later })).toBe(false);

    await prisma.syncState.updateMany({
      data: { status: "syncing", updatedAt: new Date(Date.now() - 20 * 60_000) },
    });
    expect(await cleanupPriceQueue(() => ["cardmarket"])).toBe(1);
    expect((await prisma.syncState.findFirstOrThrow()).status).toBe("pending");
  });
});

const fast = (clock = fakeClock()) => ({ now: clock.now, sleep: async () => {}, random: () => 1 });

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("what gets priced", () => {
  it("collection first, then recently viewed; never the rest of the catalog", async () => {
    const clock = fakeClock();
    const owned = await makeCard("Owned", { owned: true });
    const viewed = await makeCard("Viewed");
    const oldView = await makeCard("Viewed long ago");
    await makeCard("Never looked at");
    await recordCardView(viewed.printingId, clock.now());
    await recordCardView(oldView.printingId, new Date(clock.now().getTime() - 30 * 24 * HOUR));

    const items = await priceRefreshItems("pokemon", clock.now());
    expect(Object.fromEntries(items.map((i) => [i.key, i.priority]))).toEqual({
      [owned.variantId]: PRICE_PRIORITY.collection,
      [viewed.variantId]: PRICE_PRIORITY.recentlyViewed,
    });

    const provider = fakeProvider("cardtrader", () => [obs(100)]);
    await runPriceRefresh(provider, "pokemon", fast(clock));
    expect(provider.calls).toEqual([owned.variantId, viewed.variantId]);
  });

  it("refreshes again only once prices are older than the refresh interval", async () => {
    const clock = fakeClock();
    const { variantId } = await makeCard("Owned", { owned: true });
    const provider = fakeProvider("cardtrader", () => [obs(100)]);

    await runPriceRefresh(provider, "pokemon", { ...fast(clock), refreshAfterMs: 24 * HOUR });
    clock.advance(12 * HOUR);
    await runPriceRefresh(provider, "pokemon", { ...fast(clock), refreshAfterMs: 24 * HOUR });
    expect(provider.calls).toEqual([variantId]);

    clock.advance(13 * HOUR);
    await runPriceRefresh(provider, "pokemon", { ...fast(clock), refreshAfterMs: 24 * HOUR });
    expect(provider.calls).toEqual([variantId, variantId]);
  });

  it("a stale card page queues its variants ahead of the collection, once", async () => {
    const clock = fakeClock();
    const owned = await makeCard("Owned", { owned: true });
    const opened = await makeCard("Opened");

    expect(
      await enqueueStalePrices(
        [opened.variantId],
        ["cardtrader"],
        "pokemon",
        24 * HOUR,
        clock.now(),
      ),
    ).toBe(true);
    // Already queued: nothing new.
    expect(
      await enqueueStalePrices(
        [opened.variantId],
        ["cardtrader"],
        "pokemon",
        24 * HOUR,
        clock.now(),
      ),
    ).toBe(false);
    expect(await pricesUpdating([opened.variantId])).toBe(true);

    const provider = fakeProvider("cardtrader", () => [obs(100)]);
    await runPriceRefresh(provider, "pokemon", fast(clock));
    expect(provider.calls).toEqual([opened.variantId, owned.variantId]);
    expect(await pricesUpdating([opened.variantId])).toBe(false);

    // Fresh now: opening it again queues nothing.
    clock.advance(HOUR);
    expect(
      await enqueueStalePrices(
        [opened.variantId],
        ["cardtrader"],
        "pokemon",
        24 * HOUR,
        clock.now(),
      ),
    ).toBe(false);
  });
});

describe("failures", () => {
  it("one provider failing doesn't stop another provider or other cards", async () => {
    const clock = fakeClock();
    const a = await makeCard("A", { owned: true });
    const b = await makeCard("B", { owned: true });
    const broken = fakeProvider("ebay", () => new Error("HTTP 500 from /item_summary/search"));
    const working = fakeProvider("cardtrader", (card) => [
      obs(card.variantId === a.variantId ? 100 : 200),
    ]);

    const [bad, good] = await Promise.all([
      runPriceRefresh(broken, "pokemon", { ...fast(clock), maxAttempts: 2 }),
      runPriceRefresh(working, "pokemon", fast(clock)),
    ]);
    expect(bad.failed).toHaveLength(2);
    expect(good.succeeded.sort()).toEqual([a.variantId, b.variantId].sort());
    expect(await prisma.priceObservation.count({ where: { provider: "cardtrader" } })).toBe(2);

    const health = await prisma.providerStatus.findMany({ orderBy: { provider: "asc" } });
    expect(health.map((h) => [h.provider, h.lastSuccessAt !== null, h.lastError])).toEqual([
      ["cardtrader", true, null],
      ["ebay", false, "HTTP 500 from /item_summary/search"],
    ]);
  });

  it("waits out a rate limit (Retry-After) and records it in provider health", async () => {
    await makeCard("A", { owned: true });
    const sleep = vi.fn(async (_ms: number) => {});
    const provider = fakeProvider("cardtrader", (_c, call) =>
      call === 1 ? new RateLimitedError("cardtrader", 45_000) : [obs(100)],
    );
    const result = await runPriceRefresh(provider, "pokemon", { ...fast(), sleep });
    expect(result.succeeded).toHaveLength(1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toContain(45_000);
    const health = await prisma.providerStatus.findUniqueOrThrow({
      where: { provider: "cardtrader" },
    });
    expect(health.lastSuccessAt).not.toBeNull();
    expect(health.rateLimitedUntil).toBeNull(); // cleared by the later success
  });

  it("stops the whole run on bad credentials instead of failing every card", async () => {
    for (const name of ["A", "B", "C"]) await makeCard(name, { owned: true });
    const provider = fakeProvider(
      "ebay",
      () => new AuthError("ebay", "invalid or expired credentials (HTTP 401)"),
    );
    const result = await runPriceRefresh(provider, "pokemon", fast());
    expect(result.status).toBe("halted");
    expect(provider.calls).toHaveLength(1);
    const states = await prisma.syncState.groupBy({
      by: ["status"],
      where: { job: priceJob("ebay") },
      _count: true,
    });
    expect(Object.fromEntries(states.map((s) => [s.status, s._count]))).toEqual({
      failed: 1,
      pending: 2,
    });
  });

  it("skips providers that aren't configured", async () => {
    await makeCard("A", { owned: true });
    const provider = { ...fakeProvider("cardtrader"), isConfigured: () => false };
    expect((await runPriceRefresh(provider, "pokemon", fast())).skipped).toBe("not configured");
  });

  it("stores no prices for an unmatched card, and says so", async () => {
    const { variantId } = await makeCard("A", { owned: true });
    const provider = fakeProvider("cardtrader", () => [obs(1)], {
      status: "not_found",
      confidence: 0,
      externalId: null,
    });
    await runPriceRefresh(provider, "pokemon", fast());
    expect(provider.calls).toEqual([]);
    expect(await prisma.providerMapping.findFirstOrThrow({ where: { variantId } })).toMatchObject({
      status: "not_found",
    });
  });

  it("keeps a manual mapping instead of re-resolving it", async () => {
    const clock = fakeClock();
    const { variantId } = await makeCard("A", { owned: true });
    await prisma.providerMapping.create({
      data: {
        variantId,
        provider: "cardtrader",
        externalId: "manual-42",
        confidence: 1,
        status: "matched",
        manualOverride: true,
        resolvedAt: new Date(0),
      },
    });
    const provider = fakeProvider("cardtrader", () => [obs(100)]);
    const resolve = vi.spyOn(provider, "resolveMapping");
    await runPriceRefresh(provider, "pokemon", fast(clock));
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("observations", () => {
  it("TCGdex quotes become typed observations plus a Cardmarket mapping", async () => {
    const { printingId, variantId } = await makeCard("A");
    await recordPrices(printingId, [
      {
        finish: "NON_FOIL",
        source: "CARDMARKET",
        currency: "EUR",
        low: 10,
        mid: 30,
        trend: 25,
        observedAt: "2026-09-01T00:00:00Z",
        externalId: "771",
      },
    ]);
    // Same TCGdex timestamp again: no duplicates.
    await recordPrices(printingId, [
      {
        finish: "NON_FOIL",
        source: "CARDMARKET",
        currency: "EUR",
        low: 10,
        mid: 30,
        trend: 25,
        observedAt: "2026-09-01T00:00:00Z",
        externalId: "771",
      },
    ]);
    const rows = await prisma.priceObservation.findMany({
      where: { variantId },
      orderBy: { kind: "asc" },
    });
    expect(rows.map((r) => [r.provider, r.kind, r.amount])).toEqual([
      ["cardmarket", "lowest_listing", 10],
      ["cardmarket", "market_average", 30],
      ["cardmarket", "trend", 25],
    ]);
    expect(await prisma.providerMapping.findFirstOrThrow({ where: { variantId } })).toMatchObject({
      provider: "cardmarket",
      externalId: "771",
      status: "matched",
    });
  });

  it("reads rows written before the pricing pipeline by what their columns meant", () => {
    const legacy = {
      id: 1,
      variantId: "v",
      source: "TCGPLAYER",
      provider: null,
      kind: null,
      amount: null,
      condition: null,
      gradingCompany: null,
      grade: null,
      currency: "USD",
      low: 50,
      mid: 90,
      market: 80,
      trend: null,
      sampleSize: null,
      listingCount: null,
      payloadHash: null,
      observedAt: new Date("2026-01-01"),
    };
    expect(normalizeObservation(legacy).map((p) => [p.provider, p.kind, p.amount])).toEqual([
      ["tcgplayer", "market_average", 80],
      ["tcgplayer", "asking", 90],
      ["tcgplayer", "lowest_listing", 50],
    ]);
  });
});

describe("valuations and snapshots", () => {
  const rates = { source: "ecb" as const, asOf: "2026-09-01", perEur: { EUR: 1, USD: 1.25 } };

  it("combines providers' headlines in EUR, leaving out low-confidence matches", () => {
    const at = new Date();
    const points = [
      {
        provider: "cardmarket",
        kind: "trend" as const,
        amount: 1000,
        currency: "EUR",
        condition: null,
        listingCount: null,
        observedAt: at,
      },
      {
        provider: "tcgplayer",
        kind: "market_average" as const,
        amount: 1250,
        currency: "USD",
        condition: null,
        listingCount: null,
        observedAt: at,
      },
      {
        provider: "cardtrader",
        kind: "lowest_listing" as const,
        amount: 99_999,
        currency: "EUR",
        condition: "NEAR_MINT",
        listingCount: 1,
        observedAt: at,
      },
    ];
    expect(valueFromPoints(points, rates, new Set(["cardtrader"]))).toEqual({
      valueEur: 1000,
      sources: 2,
    });
  });

  it("writes a daily portfolio snapshot from collection x values, with cost basis", async () => {
    const { variantId } = await makeCard("A", { owned: true });
    const provider = fakeProvider("cardtrader", () => [obs(1500)]);
    await runPriceRefresh(provider, "pokemon", fast());
    expect(await computeValuations()).toBe(1);
    expect((await latestValuations([variantId])).get(variantId)!.valueEur).toBe(1500);

    await snapshotPortfolio(new Date("2026-09-10T15:00:00Z"));
    await snapshotPortfolio(new Date("2026-09-10T18:00:00Z")); // same day: overwritten, not duplicated
    const snaps = await prisma.portfolioSnapshot.findMany();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({
      currency: "EUR",
      totalValue: 3000,
      costBasis: 1000,
      itemCount: 2,
    });
  });

  it("price points come back per variant, oldest first", async () => {
    const { variantId } = await makeCard("A", { owned: true });
    const provider = fakeProvider("cardtrader", (_c, call) => [
      obs(call * 100, { observedAt: new Date(Date.UTC(2026, 8, call)) }),
    ]);
    const clock = fakeClock();
    await runPriceRefresh(provider, "pokemon", fast(clock));
    clock.advance(48 * HOUR);
    await runPriceRefresh(provider, "pokemon", fast(clock));
    expect((await pricePoints([variantId])).get(variantId)!.map((p) => p.amount)).toEqual([
      100, 200,
    ]);
  });
});

describe("exchange rates", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time='2026-09-25'>
<Cube currency='USD' rate='1.1712'/><Cube currency='JPY' rate='172.45'/><Cube currency='GBP' rate='0.8731'/>
<Cube currency='CHF' rate='0.9321'/><Cube currency='SEK' rate='11.02'/>
</Cube></Cube></gesmes:Envelope>`;

  it("parses the ECB daily file", () => {
    expect(parseEcbXml(xml)).toEqual({
      asOf: "2026-09-25",
      perEur: { EUR: 1, USD: 1.1712, JPY: 172.45, GBP: 0.8731, CHF: 0.9321, SEK: 11.02 },
    });
  });

  it("stores ECB rates over the built-in ones, and keeps built-ins when the fetch fails", async () => {
    expect((await loadFxRates()).source).toBe("builtin");
    const down = vi.fn(
      async () => new Response("down", { status: 503 }),
    ) as unknown as typeof fetch;
    const failed = await refreshFxRates({ fetch: down, ...fast(), maxAttempts: 1 });
    expect(failed.failed).toHaveLength(1);
    expect((await loadFxRates()).source).toBe("builtin");

    const ok = vi.fn(async () => new Response(xml)) as unknown as typeof fetch;
    const clock = fakeClock(new Date(Date.now() + 60_000));
    await refreshFxRates({ fetch: ok, ...fast(clock) });
    const rates = await loadFxRates();
    expect(rates).toMatchObject({ source: "ecb", asOf: "2026-09-25" });
    expect(rates.perEur.USD).toBe(1.1712);
    expect(rates.perEur.BRL).toBeGreaterThan(0); // built-in fills what the ECB doesn't cover
  });
});
