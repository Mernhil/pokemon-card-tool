import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/client";
import {
  cacheFileName,
  evictImageCache,
  getCardImage,
  pinnedPrintingIds,
} from "../src/image-cache";
import { fakeClock, resetDb } from "./helpers";

const dir = join(process.env.TCG_VAULT_TEST_DIR!, "image-cache");

function imageResponse(bytes = 100, type = "image/webp") {
  return new Response(new Uint8Array(bytes).fill(7), {
    status: 200,
    headers: { "content-type": type },
  });
}

/** A fetch that answers from a URL -> response table and records calls. */
function fakeFetch(table: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const make = table[url];
    return make ? make() : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

let n = 0;
async function makePrinting(urls: string[] | null, { owned = false } = {}) {
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
    where: { gameId_code: { gameId: game.id, code: "s1" } },
    update: {},
    create: { gameId: game.id, code: "s1", name: "Set" },
  });
  const card = await prisma.card.create({
    data: { gameId: game.id, name: `Card ${i}`, cardType: "Pokemon", canonicalKey: `k${i}` },
  });
  const printing = await prisma.printing.create({
    data: {
      cardId: card.id,
      setId: set.id,
      collectorNumber: `${i}/99`,
      sortNumber: i,
      imageUrls: urls ? JSON.stringify(urls) : null,
    },
  });
  const variant = await prisma.printVariant.create({
    data: { printingId: printing.id, languageCode: "en" },
  });
  if (owned) await prisma.collectionItem.create({ data: { variantId: variant.id } });
  return printing.id;
}

beforeEach(async () => {
  await resetDb();
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
});
afterAll(() => prisma.$disconnect());

describe("getCardImage", () => {
  it("downloads on first view, then serves from disk without hitting the network", async () => {
    const id = await makePrinting(["https://img/a/high.webp"]);
    const fetchImpl = fakeFetch({ "https://img/a/high.webp": () => imageResponse(123) });

    const first = await getCardImage(id, { dir, fetch: fetchImpl });
    expect(first).toMatchObject({ from: "remote", contentType: "image/webp" });
    expect(first!.body.length).toBe(123);

    const second = await getCardImage(id, { dir, fetch: fetchImpl });
    expect(second).toMatchObject({ from: "cache", contentType: "image/webp" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, cacheFileName(id)))).toBe(true);
    expect(
      await prisma.imageCacheEntry.findUnique({ where: { key: cacheFileName(id) } }),
    ).toMatchObject({
      printingId: id,
      bytes: 123,
    });
  });

  it("tries the next candidate URL on a 404", async () => {
    const id = await makePrinting(["https://img/b/high.webp", "https://img/b/high.png"]);
    const fetchImpl = fakeFetch({ "https://img/b/high.png": () => imageResponse(50, "image/png") });
    expect(await getCardImage(id, { dir, fetch: fetchImpl })).toMatchObject({
      contentType: "image/png",
    });
  });

  it("never caches a failure: network error, 5xx, or a non-image body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = await makePrinting(["https://img/down.webp"]);
    const error = await makePrinting(["https://img/500.webp"]);
    const html = await makePrinting(["https://img/html.webp"]);
    const fetchImpl = fakeFetch({
      "https://img/down.webp": () => Promise.reject(new TypeError("fetch failed")),
      "https://img/500.webp": () => new Response("oops", { status: 503 }),
      "https://img/html.webp": () => imageResponse(10, "text/html"),
    });
    for (const id of [down, error, html]) {
      expect(await getCardImage(id, { dir, fetch: fetchImpl })).toBeNull();
    }
    expect(await prisma.imageCacheEntry.count()).toBe(0);
    expect(readdirSync(dir)).toEqual([]);

    // Next view retries (and succeeds once the source is back).
    const ok = fakeFetch({ "https://img/down.webp": () => imageResponse() });
    expect(await getCardImage(down, { dir, fetch: ok })).toMatchObject({ from: "remote" });
    warn.mockRestore();
  });

  it("returns null for a card with no image URLs or all 404s", async () => {
    const none = await makePrinting(null);
    const missing = await makePrinting(["https://img/404.webp"]);
    const fetchImpl = fakeFetch({});
    expect(await getCardImage(none, { dir, fetch: fetchImpl })).toBeNull();
    expect(await getCardImage(missing, { dir, fetch: fetchImpl })).toBeNull();
    expect(await getCardImage("no-such-printing", { dir, fetch: fetchImpl })).toBeNull();
  });

  it("re-downloads when the file vanished from disk", async () => {
    const id = await makePrinting(["https://img/c.webp"]);
    const fetchImpl = fakeFetch({ "https://img/c.webp": () => imageResponse() });
    await getCardImage(id, { dir, fetch: fetchImpl });
    await rm(join(dir, cacheFileName(id)));
    expect(await getCardImage(id, { dir, fetch: fetchImpl })).toMatchObject({ from: "remote" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one download between simultaneous requests for the same card", async () => {
    const id = await makePrinting(["https://img/d.webp"]);
    const fetchImpl = fakeFetch({ "https://img/d.webp": () => imageResponse() });
    await Promise.all([1, 2, 3].map(() => getCardImage(id, { dir, fetch: fetchImpl })));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("cacheFileName", () => {
  it("only ever produces a plain file name", () => {
    expect(cacheFileName("clx123abc")).toBe("clx123abc.img");
    expect(cacheFileName("../../etc/passwd")).toBe("______etc_passwd.img");
    expect(cacheFileName("a/b\\c")).not.toMatch(/[\\/]/);
  });
});

describe("eviction", () => {
  it("evicts least-recently-used images down to the cap, and never pinned (collection) ones", async () => {
    const clock = fakeClock();
    const owned = await makePrinting(["https://img/owned.webp"], { owned: true });
    const old = await makePrinting(["https://img/old.webp"]);
    const recent = await makePrinting(["https://img/recent.webp"]);
    const fetchImpl = fakeFetch({
      "https://img/owned.webp": () => imageResponse(400),
      "https://img/old.webp": () => imageResponse(400),
      "https://img/recent.webp": () => imageResponse(400),
    });
    const opts = { dir, fetch: fetchImpl, now: clock.now, maxBytes: 10_000 };

    // Owned is the least recently used of all — it must survive anyway.
    await getCardImage(owned, opts);
    clock.advance(60_000);
    await getCardImage(old, opts);
    clock.advance(60_000);
    await getCardImage(recent, opts);
    expect(await prisma.imageCacheEntry.count()).toBe(3);

    // Cap now fits two images: the oldest *unpinned* one goes.
    const result = await evictImageCache({ dir, maxBytes: 800 });
    expect(result).toMatchObject({ evicted: 1, freedBytes: 400, totalBytes: 800 });
    const left = (await prisma.imageCacheEntry.findMany()).map((e) => e.printingId).sort();
    expect(left).toEqual([owned, recent].sort());
    expect(existsSync(join(dir, cacheFileName(old)))).toBe(false);
    expect(existsSync(join(dir, cacheFileName(owned)))).toBe(true);
  });

  it("keeps pinned images even when they alone exceed the cap", async () => {
    const a = await makePrinting(["https://img/a1.webp"], { owned: true });
    const b = await makePrinting(["https://img/b1.webp"], { owned: true });
    const fetchImpl = fakeFetch({
      "https://img/a1.webp": () => imageResponse(500),
      "https://img/b1.webp": () => imageResponse(500),
    });
    await getCardImage(a, { dir, fetch: fetchImpl, maxBytes: 10_000 });
    await getCardImage(b, { dir, fetch: fetchImpl, maxBytes: 10_000 });
    const result = await evictImageCache({ dir, maxBytes: 100 });
    expect(result.evicted).toBe(0);
    expect(await prisma.imageCacheEntry.count()).toBe(2);
    expect(await pinnedPrintingIds()).toEqual(new Set([a, b]));
  });

  it("evicts automatically when a new download pushes the cache over its cap", async () => {
    const clock = fakeClock();
    const ids: string[] = [];
    for (const i of [1, 2, 3]) ids.push(await makePrinting([`https://img/e${i}.webp`]));
    const fetchImpl = fakeFetch(
      Object.fromEntries(
        [1, 2, 3].map((i) => [`https://img/e${i}.webp`, () => imageResponse(300)]),
      ),
    );
    for (const id of ids) {
      await getCardImage(id, { dir, fetch: fetchImpl, now: clock.now, maxBytes: 700 });
      clock.advance(60_000);
    }
    const left = (await prisma.imageCacheEntry.findMany()).map((e) => e.printingId);
    expect(left.sort()).toEqual([ids[1], ids[2]].sort());
  });
});
