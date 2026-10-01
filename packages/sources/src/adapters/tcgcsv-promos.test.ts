import { describe, expect, it } from "vitest";
import { mapTcgcsvProduct, tcgcsvSetCode } from "./tcgcsv-promos";

const ext = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));

describe("mapTcgcsvProduct", () => {
  it("maps a numbered card with prices per finish, in cents", () => {
    const p = mapTcgcsvProduct(
      {
        productId: 598114,
        name: "Poncho-wearing Pikachu - 037/SM-P",
        imageUrl: "https://cdn/product/598114_200w.jpg",
        extendedData: ext({ Number: "037/SM-P", HP: "60", CardType: "Lightning", Stage: "Basic" }),
      },
      [{ productId: 598114, lowPrice: 10, midPrice: 20.5, marketPrice: 64, subTypeName: "Holofoil" }],
    )!;
    expect(p.cardName).toBe("Poncho-wearing Pikachu");
    expect(p.collectorNumber).toBe("037/SM-P");
    expect(p.finishes).toEqual(["HOLO"]);
    expect(p.imageUrls![0]).toContain("_in_1000x1000.jpg");
    expect(p.prices).toEqual([
      { finish: "HOLO", source: "TCGPLAYER", currency: "USD", market: 6400, mid: 2050, low: 1000, externalId: "598114" },
    ]);
  });

  it("keys unnumbered old promos by product id, and skips sealed product", () => {
    const old = mapTcgcsvProduct({ productId: 7, name: "Bulbasaur", extendedData: ext({ CardType: "Grass", HP: "40" }) }, []);
    expect(old?.collectorNumber).toBe("7");
    expect(old?.cardName).toBe("Bulbasaur");
    expect(mapTcgcsvProduct({ productId: 8, name: "Booster Box", extendedData: [] }, [])).toBeNull();
  });
});

describe("tcgcsvSetCode", () => {
  it("uses the abbreviation before the colon, prefixed by region", () => {
    const g = { groupId: 1, name: "SM-P: Sun & Moon Promos" };
    expect(tcgcsvSetCode({ categoryId: 85, prefix: "JP-", languageCode: "ja" }, g)).toBe("JP-sm-p");
  });
});
