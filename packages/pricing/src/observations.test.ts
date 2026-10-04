import { describe, expect, it } from "vitest";
import { pointsForLanguage, type PricePoint } from "./observations";

const point = (provider: string): PricePoint => ({
  provider,
  kind: "market_average",
  amount: 11760,
  currency: "USD",
  condition: null,
  listingCount: null,
  observedAt: new Date(),
});

describe("TCGplayer is an English-only market", () => {
  it("shows its prices only when English is the selected language", () => {
    const points = [point("tcgplayer")];
    expect(pointsForLanguage("tcgplayer", points, "en").mode).toBe("all-languages");
    expect(pointsForLanguage("tcgplayer", points, "it")).toEqual({
      points: [],
      mode: "other-languages",
    });
  });
  it("leaves Cardmarket, which spans every language, as it was", () => {
    expect(pointsForLanguage("cardmarket", [point("cardmarket")], "it").mode).toBe("all-languages");
  });
});
