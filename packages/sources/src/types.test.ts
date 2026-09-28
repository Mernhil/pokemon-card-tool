import { describe, expect, it } from "vitest";
import type { SourceAdapter, VariantRef } from "./types";

const stubAdapter: SourceAdapter = {
  slug: "stub",
  game: "pokemon",
  languageCode: "en",
  async listSets() {
    return [];
  },
  async listSetSummaries() {
    return [];
  },
  async getSet() {
    return null;
  },
  async listPrintings() {
    return [];
  },
  async fetchPrices() {
    return [];
  },
  buildLink(variant) {
    return `https://example.com/search?q=${encodeURIComponent(variant.cardName)}`;
  },
};

describe("SourceAdapter contract", () => {
  it("buildLink is synchronous and deterministic for the same variant", () => {
    const variant: VariantRef = {
      variantId: "v1",
      externalIds: {},
      cardName: "Charizard",
      setCode: "sv8",
      collectorNumber: "199/191",
      finish: "HOLO",
      languageCode: "en",
    };

    expect(stubAdapter.buildLink(variant, {})).toBe(stubAdapter.buildLink(variant, {}));
  });
});
