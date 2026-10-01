import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/client";
import {
  cacheFileName,
  evictImageCache,
  clearImageResults,
  getCardImage,
  getCardImageResult,
  lastImageResult,
  pinnedPrintingIds,
} from "../src/image-cache";
import { clearNotFoundCache, createLimiter } from "../src/image-fetch";
import { fakeClock, resetDb } from "./helpers";

const noSleep = async () => {};
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
  clearNotFoundCache();
  clearImageResults();
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
});
afterAll(() => prisma.$disconnect());

describe("getCardImage", () => {
  it("downloads on first view, then serves from disk without hitting the network", async () => {
    const id = await makePrinting(["https://img/a/high.webp"]);
    const fetchImpl = fakeFetch({ "https://img/a/high.webp": () => imageResponse(123) });

    const first = await getCardImage(id, { dir, sleep: noSleep, fetch: fetchImpl });
    expect(first).toMatchObject({ from: "remote", contentType: "image/webp" });
    expect(first!.body.length).toBe(123);

    const second = await getCardImage(id, { dir, sleep: noSleep, fetch: fetchImpl });
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
    expect(await getCardImage(id, { dir, sleep: noSleep, fetch: fetchImpl })).toMatchObject({
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
      expect(await getCardImage(id, { dir, sleep: noSleep, fetch: fetchImpl })).toBeNull();
    }
    expect(await prisma.imageCacheEntry.count()).toBe(0);
    expect(readdirSync(dir)).toEqual([]);

    // Next view retries (and succeeds once the source is back).
    const ok = fakeFetch({ "https://img/down.webp": () => imageResponse() });
    expect(
      await getCardImage(down, {
        dir,
        sleep: noSleep,
        fetch: ok,
        now: () => new Date(Date.now() + 60_000),
      }),
    ).toMatchObject({ from: "remote" });
    warn.mockRestore();
  });

  it("returns null for a card with no image URLs or all 404s", async () => {
    const none = await makePrinting(null);
    const missing = await makePrinting(["https://img/404.webp"]);
    const fetchImpl = fakeFetch({});
    expect(await getCardImage(none, { dir, sleep: noSleep, fetch: fetchImpl })).toBeNull();
    expect(await getCardImage(missing, { dir, sleep: noSleep, fetch: fetchImpl })).toBeNull();
    expect(
      await getCardImage("no-such-printing", { dir, sleep: noSleep, fetch: fetchImpl }),
    ).toBeNull();
  });

  it("re-downloads when the file vanished from disk", async () => {
    const id = await makePrinting(["https://img/c.webp"]);
    const fetchImpl = fakeFetch({ "https://img/c.webp": () => imageResponse() });
    await getCardImage(id, { dir, sleep: noSleep, fetch: fetchImpl });
    await rm(join(dir, cacheFileName(id)));
    expect(await getCardImage(id, { dir, sleep: noSleep, fetch: fetchImpl })).toMatchObject({
      from: "remote",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one download between simultaneous requests for the same card", async () => {
    const id = await makePrinting(["https://img/d.webp"]);
    const fetchImpl = fakeFetch({ "https://img/d.webp": () => imageResponse() });
    await Promise.all(
      [1, 2, 3].map(() => getCardImage(id, { dir, sleep: noSleep, fetch: fetchImpl })),
    );
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
    const opts = { dir, sleep: noSleep, fetch: fetchImpl, now: clock.now, maxBytes: 10_000 };

    // Owned is the least recently used of all — it must survive anyway.
    await getCardImage(owned, opts);
    clock.advance(60_000);
    await getCardImage(old, opts);
    clock.advance(60_000);
    await getCardImage(recent, opts);
    expect(await prisma.imageCacheEntry.count()).toBe(3);

    // Cap now fits two images: the oldest *unpinned* one goes.
    const result = await evictImageCache({ dir, sleep: noSleep, maxBytes: 800 });
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
    await getCardImage(a, { dir, sleep: noSleep, fetch: fetchImpl, maxBytes: 10_000 });
    await getCardImage(b, { dir, sleep: noSleep, fetch: fetchImpl, maxBytes: 10_000 });
    const result = await evictImageCache({ dir, sleep: noSleep, maxBytes: 100 });
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
      await getCardImage(id, {
        dir,
        sleep: noSleep,
        fetch: fetchImpl,
        now: clock.now,
        maxBytes: 700,
      });
      clock.advance(60_000);
    }
    const left = (await prisma.imageCacheEntry.findMany()).map((e) => e.printingId);
    expect(left.sort()).toEqual([ids[1], ids[2]].sort());
  });
});

describe("candidates, retries, negative cache, custom images", () => {
  async function pokemonPrinting(
    setCode: string,
    series: string,
    number: string,
    urls: string[] | null,
  ) {
    const i = ++n;
    const game = await prisma.game.upsert({
      where: { slug: "pokemon" },
      update: {},
      create: { slug: "pokemon", name: "Pokémon" },
    });
    const set = await prisma.set.upsert({
      where: { gameId_code: { gameId: game.id, code: setCode } },
      update: {},
      create: { gameId: game.id, code: setCode, name: setCode, series },
    });
    const card = await prisma.card.create({
      data: { gameId: game.id, name: `C${i}`, cardType: "Pokemon", canonicalKey: `pk${i}` },
    });
    const p = await prisma.printing.create({
      data: {
        cardId: card.id,
        setId: set.id,
        collectorNumber: number,
        sortNumber: i,
        imageUrls: urls ? JSON.stringify(urls) : null,
      },
    });
    return p.id;
  }

  it("a printing with no stored URL gets TCGdex asset variants, then pokemontcg.io, in order", async () => {
    const id = await pokemonPrinting("sv03.5", "Scarlet & Violet", "5/207", null);
    const fetchImpl = fakeFetch({});
    const result = await getCardImageResult(id, { dir, sleep: noSleep, fetch: fetchImpl });
    expect(result.status).toBe("not-found");
    expect(result.attempts.map((a) => a.url)).toEqual([
      "https://assets.tcgdex.net/en/sv/sv03.5/5/high.webp",
      "https://assets.tcgdex.net/en/sv/sv03.5/5/high.png",
      "https://assets.tcgdex.net/en/sv/sv03.5/5/low.webp",
      "https://images.pokemontcg.io/sv3pt5/5_hires.png",
      "https://images.pokemontcg.io/sv3pt5/5.png",
    ]);
    expect(result.reason).toMatch(/TCGdex: not found \(404\).*pokemontcg\.io: not found \(404\)/);
  });

  it("stored URLs come first and constructed ones fill in when they 404", async () => {
    const id = await pokemonPrinting("sv01", "Scarlet & Violet", "1/198", [
      "https://assets.tcgdex.net/x/high.webp",
    ]);
    const fetchImpl = fakeFetch({
      "https://images.pokemontcg.io/sv1/1_hires.png": () => imageResponse(9, "image/png"),
    });
    const result = await getCardImageResult(id, { dir, sleep: noSleep, fetch: fetchImpl });
    expect(result).toMatchObject({ status: "remote" });
    expect(result.attempts[0]!.url).toBe("https://assets.tcgdex.net/x/high.webp");
  });

  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    const id = await makePrinting(["https://img/flaky.webp"]);
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl = fakeFetch({
      "https://img/flaky.webp": () =>
        ++calls === 1
          ? new Response("slow down", { status: 429, headers: { "retry-after": "2" } })
          : calls === 2
            ? new Response("oops", { status: 503 })
            : imageResponse(10),
    });
    const result = await getCardImageResult(id, {
      dir,
      fetch: fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(result.status).toBe("remote");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([2000, 1000]); // Retry-After first, then exponential backoff
  });

  it("gives up after the retries, says why, and doesn't hammer the source again right away", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await makePrinting(["https://img/down.webp"]);
    const fetchImpl = fakeFetch({
      "https://img/down.webp": () => new Response("no", { status: 503 }),
    });
    const first = await getCardImageResult(id, { dir, sleep: noSleep, fetch: fetchImpl });
    expect(first.status).toBe("failed");
    expect(first.reason).toMatch(/server error 503 after 3 tries/);
    const calls = fetchImpl.mock.calls.length;
    await getCardImageResult(id, { dir, sleep: noSleep, fetch: fetchImpl });
    expect(fetchImpl.mock.calls.length).toBe(calls); // cool-down
    warn.mockRestore();
  });

  it("remembers a confirmed 404 for a while, so other cards skip that URL", async () => {
    const a = await makePrinting(["https://img/shared-missing.webp"]);
    const b = await makePrinting(["https://img/shared-missing.webp"]);
    const fetchImpl = fakeFetch({});
    await getCardImage(a, { dir, sleep: noSleep, fetch: fetchImpl });
    await getCardImage(b, { dir, sleep: noSleep, fetch: fetchImpl });
    const asked = fetchImpl.mock.calls.filter(
      (c) => String(c[0]) === "https://img/shared-missing.webp",
    );
    expect(asked).toHaveLength(1);
    expect(lastImageResult(b)?.attempts[0]?.outcome).toBe("known-missing");
  });

  it("limits concurrent downloads", async () => {
    const limiter = createLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limiter.run(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("a custom image wins over the cache and the sources, and never touches the network", async () => {
    const { putFile } = await import("@tcg-vault/shared");
    const id = await makePrinting(["https://img/real.webp"]);
    await putFile(`custom/${id}.png`, Buffer.from("mine"));
    await prisma.printing.update({ where: { id }, data: { customImageKey: `custom/${id}.png` } });
    const fetchImpl = fakeFetch({ "https://img/real.webp": () => imageResponse() });
    const result = await getCardImageResult(id, { dir, sleep: noSleep, fetch: fetchImpl });
    expect(result).toMatchObject({
      status: "custom",
      image: { from: "custom", contentType: "image/png" },
    });
    expect(result.image!.body.toString()).toBe("mine");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("reprints with no scan of their own", () => {
  it("never borrow another printing's art: they report no image, and cache nothing", async () => {
    const originalId = await makePrinting(["https://img.test/original.webp"]);
    const original = await prisma.printing.findUniqueOrThrow({ where: { id: originalId } });
    const reprint = await prisma.printing.create({
      data: {
        cardId: original.cardId,
        setId: original.setId,
        collectorNumber: "001/30",
        sortNumber: 1001,
        imageUrls: JSON.stringify(["https://img.test/missing-reprint.webp"]),
      },
    });
    const result = await getCardImageResult(reprint.id, {
      dir,
      fetch: fakeFetch({ "https://img.test/original.webp": () => imageResponse(55) }),
      sleep: noSleep,
      now: fakeClock().now,
    });
    expect(result.image).toBeNull();
    expect(await prisma.imageCacheEntry.count()).toBe(0);
  });
});
