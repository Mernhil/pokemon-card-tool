import type { CatalogSourceAdapter, SourcePrinting, SourceSet } from "@tcg-vault/sources";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CATALOG_JOB,
  catalogSyncStatus,
  plainSyncError,
  runCatalogSync,
  syncCatalogSets,
} from "../src/catalog-sync";
import { prisma } from "../src/client";
import { fakeClock, resetDb } from "./helpers";

function printing(setCode: string, n: number, extra: Partial<SourcePrinting> = {}): SourcePrinting {
  const num = String(n).padStart(3, "0");
  return {
    externalCardId: `${setCode}-${num}`,
    cardName: `Card ${setCode} ${num}`,
    cardType: "Pokemon",
    subtypes: [],
    collectorNumber: `${num}/010`,
    attributes: { hp: n * 10 },
    finishes: ["NON_FOIL", "REVERSE_HOLO"],
    imageUrls: [`https://img.example/${setCode}/${num}/high.webp`],
    ...extra,
  };
}

/** A scripted catalog source; `fail` makes a set's card download throw. */
class FakeAdapter implements CatalogSourceAdapter {
  readonly slug = "fake-source";
  readonly game = "pokemon";
  readonly languageCode = "en";
  calls: string[] = [];
  fail = new Set<string>();
  sets: Array<SourceSet & { cards: SourcePrinting[] }> = [];

  constructor(codes: string[], cardsPerSet = 3) {
    this.sets = codes.map((code) => ({
      code,
      name: `Set ${code}`,
      totalCards: cardsPerSet,
      cards: Array.from({ length: cardsPerSet }, (_, i) => printing(code, i + 1)),
    }));
  }
  async listSets() {
    return this.sets;
  }
  async listSetSummaries() {
    // Newest first, like TCGdex after reversing.
    return [...this.sets].reverse().map((s) => ({ code: s.code, name: s.name }));
  }
  async getSet(code: string) {
    return this.sets.find((s) => s.code === code) ?? null;
  }
  async listPrintings(code: string) {
    this.calls.push(code);
    if (this.fail.has(code)) throw new Error(`TCGdex request failed: ${code} -> HTTP 503`);
    return this.sets.find((s) => s.code === code)?.cards ?? [];
  }
}

const fast = (clock = fakeClock()) => ({
  now: clock.now,
  sleep: async () => {},
  random: () => 1,
  delayMs: 0,
  concurrency: 1,
  maxAttempts: 2,
  updateValuations: false,
});

async function setStatuses() {
  const rows = await prisma.syncState.findMany({ where: { job: CATALOG_JOB } });
  return Object.fromEntries(rows.map((r) => [r.itemKey, r.status]));
}

async function printingCount(code: string) {
  return prisma.printing.count({ where: { set: { code } } });
}

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("runCatalogSync", () => {
  it("syncs every set newest first and writes metadata without downloading images", async () => {
    const adapter = new FakeAdapter(["s1", "s2", "s3"]);
    const result = await runCatalogSync(adapter, fast());

    expect(adapter.calls).toEqual(["s3", "s2", "s1"]);
    expect(await setStatuses()).toEqual({ s1: "done", s2: "done", s3: "done" });
    expect(result.printingsCreated).toBe(9);
    expect(await prisma.printVariant.count()).toBe(18);

    const p = await prisma.printing.findFirstOrThrow({
      where: { collectorNumber: "001/010", set: { code: "s1" } },
    });
    // Virtual key: fetched and cached by the media route on first view.
    expect(p.imageKey).toBe(`remote/${p.id}`);
    expect(JSON.parse(p.imageUrls!)).toEqual(["https://img.example/s1/001/high.webp"]);
    expect(await prisma.imageCacheEntry.count()).toBe(0);
    expect(await prisma.externalRef.count({ where: { source: "fake-source" } })).toBe(9);
  });

  it("one failing set doesn't block the others", async () => {
    const adapter = new FakeAdapter(["s1", "bad", "s3"]);
    adapter.fail.add("bad");
    const result = await runCatalogSync(adapter, fast());

    expect(await setStatuses()).toEqual({ s1: "done", bad: "failed", s3: "done" });
    expect(await printingCount("s1")).toBe(3);
    expect(await printingCount("s3")).toBe(3);
    expect(result.run.failed.map((f) => f.key)).toEqual(["bad"]);
    const status = await catalogSyncStatus("pokemon");
    expect(status).toMatchObject({ total: 3, done: 2, failed: 1 });
    expect(status.failures[0]).toMatchObject({ code: "bad", attempts: 2 });
    expect(status.failures[0]!.error).toMatch(/HTTP 503/);
  });

  it("never leaves a half-written set: a failure mid-write rolls the whole set back", async () => {
    const adapter = new FakeAdapter(["s1"], 5);
    // The 4th card is invalid (no name) -> the DB rejects it after 3 cards were written.
    adapter.sets[0]!.cards[3] = printing("s1", 4, { cardName: undefined as unknown as string });

    const clock = fakeClock();
    await runCatalogSync(adapter, fast(clock));
    expect(await setStatuses()).toEqual({ s1: "failed" });
    expect(await printingCount("s1")).toBe(0);
    expect(await prisma.card.count()).toBe(0);

    // Fixed at the source: the next run completes it.
    adapter.sets[0]!.cards[3] = printing("s1", 4);
    clock.advance(60_000);
    await runCatalogSync(adapter, fast(clock));
    expect(await setStatuses()).toEqual({ s1: "done" });
    expect(await printingCount("s1")).toBe(5);
  });

  it("resumes after being interrupted: only unfinished sets are fetched again", async () => {
    const clock = fakeClock();
    const adapter = new FakeAdapter(["s1", "s2", "s3", "s4"]);
    // First run is "killed" after two sets.
    await runCatalogSync(adapter, { ...fast(clock), maxItems: 2 });
    expect(await setStatuses()).toEqual({ s1: "pending", s2: "pending", s3: "done", s4: "done" });

    adapter.calls = [];
    clock.advance(60_000);
    await runCatalogSync(adapter, fast(clock));
    expect(adapter.calls).toEqual(["s2", "s1"]);
    expect(Object.values(await setStatuses()).every((s) => s === "done")).toBe(true);
  });

  it("re-syncing a set updates it in place and keeps owned variants", async () => {
    const clock = fakeClock();
    const adapter = new FakeAdapter(["s1"], 1);
    await runCatalogSync(adapter, fast(clock));
    const variant = await prisma.printVariant.findFirstOrThrow({
      where: { finish: "REVERSE_HOLO" },
    });
    await prisma.collectionItem.create({ data: { variantId: variant.id, quantity: 1 } });

    // Source stops reporting reverse holo; the owned variant must survive.
    adapter.sets[0]!.cards[0] = printing("s1", 1, { finishes: ["NON_FOIL"], cardName: "Renamed" });
    clock.advance(60_000);
    const result = await syncCatalogSets(["s1"], fast(clock), adapter);

    expect(result.cardsCreated + result.cardsUpdated).toBe(1);
    expect(result.variantsKeptStale).toBe(1);
    expect(await prisma.printing.count()).toBe(1);
    expect(await prisma.printVariant.findUnique({ where: { id: variant.id } })).not.toBeNull();
    expect(await prisma.collectionItem.count()).toBe(1);
  });

  it("keeps a legacy downloaded image key when the file is still on disk", async () => {
    const { putFile } = await import("@tcg-vault/shared");
    const clock = fakeClock();
    const adapter = new FakeAdapter(["s1"], 1);
    await runCatalogSync(adapter, fast(clock));
    await putFile("pokemon/s1/001-010.webp", Buffer.from("img"));
    await prisma.printing.updateMany({ data: { imageKey: "pokemon/s1/001-010.webp" } });

    clock.advance(60_000);
    await syncCatalogSets(["s1"], fast(clock), adapter);
    expect((await prisma.printing.findFirstOrThrow()).imageKey).toBe("pokemon/s1/001-010.webp");
  });

  it("reports unknown set codes without failing the others", async () => {
    const adapter = new FakeAdapter(["s1"]);
    const result = await syncCatalogSets(["s1", "nope"], fast(), adapter);
    expect(result.unknownCodes).toEqual(["nope"]);
    expect(result.setsProcessed).toBe(1);
  });
});

describe("sets the source can't provide", () => {
  it("an empty set is parked as unavailable, not failed, with a plain reason", async () => {
    const adapter = new FakeAdapter(["s1", "gap", "s3"]);
    adapter.sets.find((s) => s.code === "gap")!.cards = []; // listed with 3 cards, none delivered
    const result = await runCatalogSync(adapter, fast());

    expect(await setStatuses()).toEqual({ s1: "done", gap: "unavailable", s3: "done" });
    expect(result.run.failed).toEqual([]);
    expect(result.run.unavailable?.map((u) => u.key)).toEqual(["gap"]);
    const status = await catalogSyncStatus("pokemon");
    expect(status).toMatchObject({ total: 3, done: 2, failed: 0, unavailable: 1 });
    expect(status.failures).toEqual([]);
    expect(status.unavailableSets[0]).toMatchObject({ code: "gap", attempts: 1 });
    expect(status.unavailableSets[0]!.message).toMatch(/no card data/);
    // Looked twice before believing it, never retried within the run.
    expect(adapter.calls.filter((c) => c === "gap")).toHaveLength(2);
  });

  it("is checked again only after about a month, or on demand", async () => {
    const clock = fakeClock();
    const adapter = new FakeAdapter(["gap"]);
    adapter.sets[0]!.cards = [];
    await runCatalogSync(adapter, fast(clock));
    const callsAfterFirst = adapter.calls.length;

    clock.advance(7 * 86_400_000);
    await runCatalogSync(adapter, fast(clock));
    expect(adapter.calls.length).toBe(callsAfterFirst);

    // The source catches up: a month later the set syncs.
    adapter.sets[0]!.cards = [printing("gap", 1)];
    clock.advance(30 * 86_400_000);
    await runCatalogSync(adapter, fast(clock));
    expect(await setStatuses()).toEqual({ gap: "done" });
    expect(await printingCount("gap")).toBe(1);
  });

  it("a set the source no longer has is unavailable too, and the next sync doesn't double-count it", async () => {
    const adapter = new FakeAdapter(["s1", "gone"]);
    const summaries = adapter.listSetSummaries.bind(adapter);
    adapter.getSet = async (code: string) =>
      code === "gone" ? null : (adapter.sets.find((s) => s.code === code) ?? null);
    adapter.listSetSummaries = summaries;
    await runCatalogSync(adapter, fast());
    expect(await setStatuses()).toEqual({ s1: "done", gone: "unavailable" });
    expect((await catalogSyncStatus("pokemon")).unavailableSets[0]!.message).toMatch(
      /no set "gone"/,
    );
  });

  it("real failures stay failures (never hidden as unavailable)", async () => {
    const adapter = new FakeAdapter(["s1", "bad"]);
    adapter.fail.add("bad");
    await runCatalogSync(adapter, fast());
    expect(await setStatuses()).toEqual({ s1: "done", bad: "failed" });
    const status = await catalogSyncStatus("pokemon");
    expect(status.unavailable).toBe(0);
    expect(status.failures[0]!.message).toMatch(/server error/);
  });

  it("a source listing the same set code twice doesn't break discovery", async () => {
    const adapter = new FakeAdapter(["s1", "s2"]);
    const summaries = await adapter.listSetSummaries();
    adapter.listSetSummaries = async () => [...summaries, { code: "s1", name: "Set s1 (again)" }];
    const result = await runCatalogSync(adapter, fast());
    expect(result.run.discoveryError).toBeUndefined();
    expect(await setStatuses()).toEqual({ s1: "done", s2: "done" });
  });
});

describe("plainSyncError", () => {
  it("explains the common errors in plain language", () => {
    expect(plainSyncError("e.getSet is not a function")).toMatch(/bug in the app/);
    expect(plainSyncError("fetch failed ECONNRESET")).toMatch(/Couldn't reach the source/);
    expect(plainSyncError("Unique constraint failed on the fields: (`job`)")).toMatch(
      /bug in the app/,
    );
    expect(plainSyncError("something odd")).toBe("something odd");
  });
});
