import type { CatalogSourceAdapter, SourcePrinting } from "@tcg-vault/sources";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runCatalogSync } from "../src/catalog-sync";
import { prisma } from "../src/client";
import {
  matchImageFiles,
  numberFromFileName,
  removeCustomImage,
  setCustomImage,
  validateCustomImage,
} from "../src/custom-image";
import { getCardImageResult } from "../src/image-cache";
import { fakeClock, resetDb } from "./helpers";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Uint8Array.from([
  ...Buffer.from("RIFF"),
  0,
  0,
  0,
  0,
  ...Buffer.from("WEBP"),
  1,
]);

function card(n: number, withImage: boolean): SourcePrinting {
  const num = String(n).padStart(3, "0");
  return {
    externalCardId: `t-${num}`,
    cardName: `Card ${num}`,
    cardType: "Pokemon",
    subtypes: [],
    collectorNumber: `${num}/030`,
    attributes: {},
    imageUrls: withImage ? [`https://img.example/${num}.webp`] : undefined,
  };
}

function adapter(cards: SourcePrinting[]): CatalogSourceAdapter {
  const set = { code: "30th", name: "30th Celebration", totalCards: cards.length };
  return {
    slug: "fake",
    game: "pokemon",
    languageCode: "en",
    listSets: async () => [set],
    listSetSummaries: async () => [{ code: set.code, name: set.name }],
    getSet: async () => set,
    listPrintings: async () => cards,
  };
}

const fast = (clock = fakeClock()) => ({
  now: clock.now,
  sleep: async () => {},
  random: () => 1,
  delayMs: 0,
  concurrency: 1,
  maxAttempts: 1,
  updateValuations: false,
});

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("validateCustomImage", () => {
  it("accepts PNG, JPEG and WebP by content, whatever the file is called", () => {
    expect(validateCustomImage(PNG)).toEqual({ ok: true, type: "image/png" });
    expect(validateCustomImage(JPG)).toEqual({ ok: true, type: "image/jpeg" });
    expect(validateCustomImage(WEBP)).toEqual({ ok: true, type: "image/webp" });
  });

  it("rejects empty files, non-images and oversized files", () => {
    expect(validateCustomImage(new Uint8Array())).toEqual({ ok: false, error: "empty" });
    expect(validateCustomImage(Buffer.from("<html>not an image</html>"))).toEqual({
      ok: false,
      error: "not-an-image",
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(validateCustomImage(big)).toEqual({ ok: false, error: "too-big" });
  });
});

describe("custom images and the catalog sync", () => {
  it("a custom image is served instead of the sources, and survives a re-sync", async () => {
    const clock = fakeClock();
    // Card 1 has no scan at the source (the 30th Celebration case), card 2 does.
    await runCatalogSync(adapter([card(1, false), card(2, true)]), fast(clock));
    const missing = await prisma.printing.findFirstOrThrow({ where: { collectorNumber: "001/030" } });

    const saved = await setCustomImage(missing.id, PNG);
    expect(saved.ok).toBe(true);
    const fetchImpl = (() => {
      throw new Error("no network in tests");
    }) as unknown as typeof fetch;
    expect(await getCardImageResult(missing.id, { fetch: fetchImpl })).toMatchObject({
      status: "custom",
    });

    // Re-sync: the source still has nothing for it (and changes card 2's scan).
    clock.advance(60 * 86_400_000);
    await runCatalogSync(
      adapter([card(1, false), { ...card(2, true), imageUrls: ["https://img.example/new.webp"] }]),
      fast(clock),
    );
    const after = await prisma.printing.findFirstOrThrow({ where: { id: missing.id } });
    expect(after.customImageKey).toBe(saved.ok ? saved.key : null);
    expect(after.imageKey).toBe(`remote/${missing.id}`);
    expect(await getCardImageResult(missing.id, { fetch: fetchImpl })).toMatchObject({
      status: "custom",
    });
  });

  it("replacing removes the old file; removing falls back to the normal sources", async () => {
    await runCatalogSync(adapter([card(1, false)]), fast());
    const p = await prisma.printing.findFirstOrThrow();
    const first = await setCustomImage(p.id, PNG);
    const second = await setCustomImage(p.id, JPG);
    expect(first.ok && second.ok && first.key !== second.key).toBe(true);
    const { hasFile } = await import("@tcg-vault/shared");
    expect(await hasFile((first as { key: string }).key)).toBe(false);
    expect(await hasFile((second as { key: string }).key)).toBe(true);

    expect(await removeCustomImage(p.id)).toBe(true);
    expect(await hasFile((second as { key: string }).key)).toBe(false);
    expect((await prisma.printing.findFirstOrThrow()).customImageKey).toBeNull();
    expect(await removeCustomImage(p.id)).toBe(false);
  });

  it("refuses bad input without changing the card", async () => {
    await runCatalogSync(adapter([card(1, false)]), fast());
    const p = await prisma.printing.findFirstOrThrow();
    expect(await setCustomImage(p.id, Buffer.from("nope"))).toEqual({
      ok: false,
      error: "not-an-image",
    });
    expect(await setCustomImage("missing-id", PNG)).toEqual({ ok: false, error: "no-such-card" });
    expect((await prisma.printing.findFirstOrThrow()).customImageKey).toBeNull();
  });
});

describe("matching image files to a set", () => {
  const printings = [
    { id: "p1", collectorNumber: "001/030", cardName: "Bulbasaur" },
    { id: "p2", collectorNumber: "004/030", cardName: "Charmander" },
    { id: "p3", collectorNumber: "TG05", cardName: "Gallery card" },
    { id: "p4", collectorNumber: "010/030", cardName: "A" },
    { id: "p5", collectorNumber: "010/030", cardName: "A alt" },
  ];

  it("reads the collector number from common file names", () => {
    expect(numberFromFileName("004.png")).toBe("004");
    expect(numberFromFileName("4.jpg")).toBe("4");
    expect(numberFromFileName("004-charmander.webp")).toBe("004");
    expect(numberFromFileName("30th 004.png")).toBe("004");
    expect(numberFromFileName("TG05.png")).toBe("TG05");
    expect(numberFromFileName("charmander.png")).toBeNull();
  });

  it("matches ignoring zero padding, and reports what it can't match instead of guessing", () => {
    const result = matchImageFiles(
      [
        { name: "4.png" },
        { name: "001.jpg" },
        { name: "tg5.png" },
        { name: "99.png" },
        { name: "10.png" },
        { name: "readme.txt" },
      ],
      printings,
    );
    expect(result.map((r) => r.printingId)).toEqual(["p2", "p1", "p3", null, null, null]);
    expect(result[3]!.problem).toMatch(/No card numbered 99/);
    expect(result[4]!.problem).toMatch(/2 cards share/);
    expect(result[5]!.problem).toMatch(/No card number/);
  });
});
