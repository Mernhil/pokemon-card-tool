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

import { TcgcsvJapanFallback } from "./tcgcsv-promos";
import { tcgdexLanguageOf } from "../pricing/tcgdex-prices";

describe("TcgcsvJapanFallback", () => {
  const fake = (async (url: string) => {
    const body = url.endsWith("/groups")
      ? [{ groupId: 7, name: "SV11W: White Flare" }]
      : url.endsWith("/products")
        ? [
            { productId: 1, name: "Lillipup - 001/086", imageUrl: "https://cdn/1_200w.jpg", extendedData: ext({ Number: "001/086", CardType: "Colorless", HP: "60" }) },
            { productId: 2, name: "Lillipup (Pattern) - 001/086", imageUrl: "https://cdn/2_200w.jpg", extendedData: ext({ Number: "001/086", CardType: "Colorless", HP: "60" }) },
          ]
        : [{ productId: 1, lowPrice: 0.1, midPrice: 0.2, marketPrice: 0.15, subTypeName: "Normal" }];
    return { ok: true, json: async () => ({ results: body }) } as Response;
  }) as unknown as typeof fetch;

  it("fills a missing picture and TCGplayer price by set id + card number, keeping what TCGdex had", async () => {
    const fb = new TcgcsvJapanFallback(fake);
    const base = { cardType: "Pokemon", subtypes: [], attributes: {}, finishes: ["NON_FOIL"] };
    const out = await fb.fill("SV11W", [
      { ...base, externalCardId: "a", cardName: "A", collectorNumber: "001/86" },
      { ...base, externalCardId: "b", cardName: "B", collectorNumber: "002/86", imageUrls: ["keep"] },
    ]);
    expect(out[0]!.imageUrls![0]).toContain("1_in_1000x1000");
    expect(out[0]!.prices).toEqual([
      { finish: "NON_FOIL", source: "TCGPLAYER", currency: "USD", market: 15, mid: 20, low: 10, externalId: "1" },
    ]);
    expect(out[1]).toEqual(expect.objectContaining({ imageUrls: ["keep"] })); // no card 2 there
    expect(out[1]!.prices).toBeUndefined();
  });

  it("leaves printings alone when the set has no tcgcsv group", async () => {
    const fb = new TcgcsvJapanFallback(fake);
    const p = { externalCardId: "a", cardName: "A", cardType: "Pokemon", subtypes: [], attributes: {}, collectorNumber: "1" };
    expect(await fb.fill("NOPE", [p])).toEqual([p]);
  });
});

describe("tcgdexLanguageOf", () => {
  it("maps our language codes back to TCGdex ids", () => {
    expect(tcgdexLanguageOf({ languageCode: "zh-Hant" })).toBe("zh-tw");
    expect(tcgdexLanguageOf({ languageCode: "ja" })).toBe("ja");
    expect(tcgdexLanguageOf({ languageCode: "en" })).toBe("en");
  });
});
