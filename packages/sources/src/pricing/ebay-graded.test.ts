import { describe, expect, it, vi } from "vitest";
import { EbayProvider, gradedObservations } from "./ebay";
import type { EbayListing } from "./ebay-filter";
import type { PricedCard } from "./types";

const listing = (itemId: string, title: string, price: number): EbayListing => ({
  itemId,
  title,
  price,
  currency: "USD",
  buyingOptions: ["FIXED_PRICE"],
});

describe("gradedObservations", () => {
  it("groups by company and grade, with median, low and count", () => {
    const rows = gradedObservations([
      listing("1", "Mew 001/064 PSA 10", 10_000),
      listing("2", "Mew 001/064 PSA 10 Gem Mint", 12_000),
      listing("3", "Mew 001/064 PSA 9", 4_000),
      listing("4", "Mew 001/064 BGS 10 Black Label", 50_000),
      listing("5", "Mew 001/064 raw near mint", 500), // not graded: ignored
    ]);
    const psa10 = rows.find((r) => r.company === "PSA" && r.gradeKey === "10")!;
    expect(psa10).toMatchObject({ median: 11_000, low: 10_000, listingCount: 2 });
    expect(rows.find((r) => r.company === "PSA" && r.gradeKey === "9")!.median).toBe(4_000);
    expect(rows.find((r) => r.company === "BGS")!.gradeKey).toBe("10:black-label");
    expect(rows).toHaveLength(3);
  });

  it("drops outliers within one company+grade, not across grades", () => {
    const rows = gradedObservations([
      listing("1", "x PSA 10", 10_000),
      listing("2", "x PSA 10", 10_500),
      listing("3", "x PSA 10", 11_000),
      listing("4", "x PSA 10", 10_200),
      listing("5", "x PSA 10", 100), // typo / lot
      listing("6", "x PSA 5", 800),
    ]);
    const psa10 = rows.find((r) => r.gradeKey === "10")!;
    expect(psa10.listingCount).toBe(4);
    expect(rows.find((r) => r.gradeKey === "5")!.median).toBe(800);
  });
});

const mew: PricedCard = {
  variantId: "v1",
  game: "pokemon",
  cardName: "Mew",
  setCode: "x",
  setName: "X",
  collectorNumber: "001/064",
  printedTotal: 64,
  finish: "HOLO",
  printingFinishes: ["HOLO"],
  languageCode: "en",
  externalIds: {},
};

describe("EbayProvider.fetchGradedPrices", () => {
  it("searches each company once, de-duplicates listings and applies the card rules", async () => {
    const search = (titles: Array<[string, string, string]>) =>
      new Response(
        JSON.stringify({
          itemSummaries: titles.map(([itemId, title, value]) => ({
            itemId,
            title,
            price: { value, currency: "USD" },
            buyingOptions: ["FIXED_PRICE"],
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/oauth2/token"))
        return new Response(JSON.stringify({ access_token: "t", expires_in: 7200 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.includes("PSA"))
        return search([
          ["a", "Mew 001/064 PSA 10", "100.00"],
          ["b", "Pikachu 001/064 PSA 10", "50.00"], // other card
        ]);
      if (url.includes("BGS")) return search([["a", "Mew 001/064 PSA 10", "100.00"]]); // duplicate
      if (url.includes("CGC")) return search([["c", "Mew 001/064 CGC Pristine 10", "200.00"]]);
      return search([]);
    });
    const provider = new EbayProvider({ clientId: "id", clientSecret: "s", fetch: fetchImpl as never });
    const rows = await provider.fetchGradedPrices(mew);

    const searches = fetchImpl.mock.calls.filter(([u]) => String(u).includes("item_summary"));
    expect(searches).toHaveLength(4);
    expect(rows.map((r) => `${r.company} ${r.gradeKey}`).sort()).toEqual(["CGC 10:pristine", "PSA 10"]);
    expect(rows.find((r) => r.company === "PSA")!).toMatchObject({ median: 10_000, listingCount: 1 });
  });
});
