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

import { TcgcsvPromoAdapter, groupSetCode } from "./tcgcsv-promos";

describe("only The Pokémon Company's playing cards go in the catalog", () => {
  it("skips jumbo cards, code cards and accessories even when they carry a number", () => {
    const card = (name: string) =>
      mapTcgcsvProduct({ productId: 1, name, extendedData: ext({ Number: "001/PCG-P", CardType: "Lightning", HP: "60" }) }, []);
    expect(card("Pikachu (Jumbo Card) - 001/PCG-P")).toBeNull();
    expect(card("Code Card - Scarlet & Violet")).toBeNull();
    expect(card("Pikachu Sleeves")).toBeNull();
    expect(card("Pikachu - 001/PCG-P")?.cardName).toBe("Pikachu");
  });
});

describe("groupSetCode", () => {
  it("reads the official set code a group is filed under", () => {
    expect(groupSetCode({ name: "ADV1: Expansion Pack" })).toBe("adv1");
    expect(groupSetCode({ name: "SV11W: White Flare" })).toBe("sv11w");
    expect(groupSetCode({ name: "BW-P: Black & White Promos" })).toBeNull();
    expect(groupSetCode({ name: "Pokemon Card 151" })).toBeNull();
  });
});

describe("Japanese cards TCGdex lists the set for but has no entry of", () => {
  const products = [
    { productId: 11, name: "Treecko - 001/055", extendedData: ext({ Number: "001/055", CardType: "Grass", HP: "50" }) },
    { productId: 12, name: "Grovyle - 002/055", extendedData: ext({ Number: "002/055", CardType: "Grass", HP: "70" }) },
    { productId: 13, name: "Sceptile ex - 003/055", extendedData: ext({ Number: "003/055", CardType: "Grass", HP: "150" }) },
  ];
  const fake = (async (url: string) => {
    const body = url.endsWith("/groups")
      ? [{ groupId: 9, name: "ADV1: Expansion Pack" }]
      : url.endsWith("/products")
        ? products
        : [{ productId: 13, lowPrice: 50, midPrice: 60, marketPrice: 55, subTypeName: "Holofoil" }];
    return { ok: true, json: async () => ({ results: body }) } as Response;
  }) as unknown as typeof fetch;

  it("takes the whole card list when TCGdex has the set without any cards", async () => {
    const out = await new TcgcsvJapanFallback(fake).fill("ADV1", []);
    expect(out.map((p) => [p.cardName, p.collectorNumber, p.externalCardId])).toEqual([
      ["Treecko", "001/055", "tcgcsv-11"],
      ["Grovyle", "002/055", "tcgcsv-12"],
      ["Sceptile ex", "003/055", "tcgcsv-13"],
    ]);
    expect(out[2]!.prices).toEqual([
      { finish: "HOLO", source: "TCGPLAYER", currency: "USD", market: 5500, mid: 6000, low: 5000, externalId: "13" },
    ]);
  });

  it("adds only the numbers TCGdex lacks, numbered like the rest of the set", async () => {
    const base = { cardType: "Pokemon", subtypes: [], attributes: {}, finishes: ["NON_FOIL"], imageUrls: ["x"] };
    const out = await new TcgcsvJapanFallback(fake).fill("ADV1", [
      { ...base, externalCardId: "ADV1-001", cardName: "Treecko", collectorNumber: "001/55" },
      { ...base, externalCardId: "ADV1-002", cardName: "Grovyle", collectorNumber: "002/55" },
    ]);
    expect(out.map((p) => [p.cardName, p.collectorNumber])).toEqual([
      ["Treecko", "001/55"],
      ["Grovyle", "002/55"],
      ["Sceptile ex", "003/55"],
    ]);
  });
});

describe("Japanese sets TCGdex has no set for at all", () => {
  const fake = (async (url: string) => {
    const body = url.endsWith("/85/groups")
      ? [
          { groupId: 1, name: "ADV1: Expansion Pack" },
          { groupId: 2, name: "SV11W: White Flare" },
          { groupId: 3, name: "CoroCoro Comic Promos" },
          { groupId: 4, name: "PCG1: Jumbo Cards" },
        ]
      : [];
    return { ok: true, json: async () => ({ results: body }) } as Response;
  }) as unknown as typeof fetch;
  const codes = async (opts?: ConstructorParameters<typeof TcgcsvPromoAdapter>[1]) =>
    (await new TcgcsvPromoAdapter(fake, opts).listSets()).map((s) => [s.code, s.series]);

  it("imports a coded set TCGdex lacks, leaving TCGdex's own sets to TCGdex", async () => {
    const japaneseSets = { enabled: async () => true, tcgdexIds: async () => ["SV11W", "PMCG1"] };
    expect(await codes({ japaneseSets })).toEqual([
      ["JP-adv1", "Japanese sets"],
      ["JP-corocoro-comic-promos", "Japanese promos"],
    ]);
  });

  it("imports none while Japanese is off, or when TCGdex's set list is unknown", async () => {
    const promosOnly = [["JP-corocoro-comic-promos", "Japanese promos"]];
    expect(await codes()).toEqual(promosOnly);
    expect(await codes({ japaneseSets: { enabled: async () => false, tcgdexIds: async () => ["SV11W"] } })).toEqual(promosOnly);
    expect(await codes({ japaneseSets: { enabled: async () => true, tcgdexIds: async () => [] } })).toEqual(promosOnly);
    expect(
      await codes({ japaneseSets: { enabled: async () => true, tcgdexIds: () => Promise.reject(new Error("offline")) } }),
    ).toEqual(promosOnly);
  });
});
