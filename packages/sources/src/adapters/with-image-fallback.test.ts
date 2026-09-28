import { describe, expect, it, vi } from "vitest";
import type { CatalogSourceAdapter, SourcePrinting, SourceSet } from "../types";
import type { ImageFallbackSource } from "./pokemontcg-image-fallback";
import { withImageFallback } from "./with-image-fallback";

const SET: SourceSet = { code: "cel25c", name: "Celebrations: Classic Collection", releaseDate: "2021-10-08" };

function printing(overrides: Partial<SourcePrinting> = {}): SourcePrinting {
  return {
    externalCardId: "cel25c-4",
    cardName: "Charizard",
    cardType: "Pokemon",
    subtypes: [],
    collectorNumber: "4/102",
    attributes: {},
    ...overrides,
  };
}

function baseAdapter(printings: SourcePrinting[]): CatalogSourceAdapter {
  return {
    slug: "fake",
    game: "pokemon",
    languageCode: "en",
    listSets: async () => [SET],
    listSetSummaries: async () => [{ code: SET.code, name: SET.name }],
    getSet: async (code) => (code === SET.code ? SET : null),
    listPrintings: async () => printings,
  };
}

describe("withImageFallback", () => {
  it("leaves printings that already have images untouched, without calling the fallback", async () => {
    const withImage = printing({ imageUrls: ["https://assets.tcgdex.net/x/high.webp"] });
    const fallback: ImageFallbackSource = { imageUrlsFor: vi.fn() };

    const wrapped = withImageFallback(baseAdapter([withImage]), fallback);
    const result = await wrapped.listPrintings(SET.code);

    expect(result).toEqual([withImage]);
    expect(fallback.imageUrlsFor).not.toHaveBeenCalled();
  });

  it("fills in fallback image URLs for printings with none", async () => {
    const missing = printing({ imageUrls: undefined });
    const fallback: ImageFallbackSource = {
      imageUrlsFor: vi.fn(async () => ["https://images.pokemontcg.io/cel25/4_hires.png"]),
    };

    const wrapped = withImageFallback(baseAdapter([missing]), fallback);
    const [result] = await wrapped.listPrintings(SET.code);

    expect(result?.imageUrls).toEqual(["https://images.pokemontcg.io/cel25/4_hires.png"]);
    expect(fallback.imageUrlsFor).toHaveBeenCalledWith({
      setName: SET.name,
      releaseDate: SET.releaseDate,
      localId: "4",
    });
  });

  it("keeps the printing as-is when the fallback also has nothing", async () => {
    const missing = printing({ imageUrls: undefined });
    const fallback: ImageFallbackSource = { imageUrlsFor: vi.fn(async () => null) };

    const wrapped = withImageFallback(baseAdapter([missing]), fallback);
    const [result] = await wrapped.listPrintings(SET.code);

    expect(result?.imageUrls).toBeUndefined();
  });

  it("swallows a fallback lookup failure and keeps the printing unchanged", async () => {
    const missing = printing({ imageUrls: undefined });
    const fallback: ImageFallbackSource = {
      imageUrlsFor: vi.fn(async () => {
        throw new Error("network down");
      }),
    };

    const wrapped = withImageFallback(baseAdapter([missing]), fallback);
    const [result] = await wrapped.listPrintings(SET.code);

    expect(result?.imageUrls).toBeUndefined();
  });

  it("skips the fallback entirely (and getSet) when nothing is missing", async () => {
    const withImage = printing({ imageUrls: ["https://assets.tcgdex.net/x/high.webp"] });
    const adapter = baseAdapter([withImage]);
    const getSetSpy = vi.spyOn(adapter, "getSet");
    const fallback: ImageFallbackSource = { imageUrlsFor: vi.fn() };

    await withImageFallback(adapter, fallback).listPrintings(SET.code);

    expect(getSetSpy).not.toHaveBeenCalled();
  });
});
