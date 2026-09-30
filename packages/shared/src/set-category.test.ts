import { describe, expect, it } from "vitest";
import { classifySet, specialSections } from "./set-category";

const pokemon = (code: string, name: string, series: string | null = null) =>
  classifySet({ game: "pokemon", code, name, series });

describe("classifySet (Pokémon)", () => {
  it("regular expansions are main, including trainer galleries and vaults", () => {
    expect(pokemon("sv01", "Scarlet & Violet", "Scarlet & Violet")).toBe("main");
    expect(pokemon("base1", "Base Set", "Base")).toBe("main");
    expect(pokemon("swsh9tg", "Brilliant Stars Trainer Gallery", "Sword & Shield")).toBe("main");
    expect(pokemon("sma", "Hidden Fates Shiny Vault", "Sun & Moon")).toBe("main");
    expect(pokemon("cel25cc", "Celebrations Classic Collection", "Sword & Shield")).toBe("main");
    expect(pokemon("xy0", "Kalos Starter Set", "XY")).toBe("main");
    expect(pokemon("30th", "30th Celebration", "Mega Evolution")).toBe("main");
  });

  it("Black Star promos and POP are promos", () => {
    expect(pokemon("basep", "Wizards Black Star Promos", "Base")).toBe("promo");
    expect(pokemon("svp", "SVP Black Star Promos", "Scarlet & Violet")).toBe("promo");
    expect(pokemon("swshp", "SWSH Black Star Promos", "Sword & Shield")).toBe("promo");
    expect(pokemon("mep", "MEP Black Star Promos", "Mega Evolution")).toBe("promo");
    expect(pokemon("miscp", "Miscellaneous Promos", "Miscellaneous")).toBe("promo");
    expect(pokemon("np", "Nintendo Black Star Promos", "POP")).toBe("promo");
    expect(pokemon("pop3", "POP Series 3", "POP")).toBe("promo");
  });

  it("promo-like sets filed under regular series come from the overrides", () => {
    expect(pokemon("wp", "W Promotional", "Base")).toBe("promo");
    expect(pokemon("si1", "Southern Islands", "Neo")).toBe("promo");
    expect(pokemon("fut2020", "Pokémon Futsal 2020", "Sword & Shield")).toBe("promo");
    expect(pokemon("jumbo", "Jumbo cards", "Miscellaneous")).toBe("other");
  });

  it("McDonald's, trainer kits and Pocket", () => {
    expect(pokemon("2021swsh", "McDonald's Collection 2021", "McDonald's Collection")).toBe(
      "mcdonalds",
    );
    expect(pokemon("tk-xy-p", "XY trainer Kit (Pikachu Libre)", "Trainer kits")).toBe(
      "trainer-kit",
    );
    expect(pokemon("mfb", "My First Battle", "Scarlet & Violet")).toBe("trainer-kit");
    expect(pokemon("A1", "Genetic Apex", "Pokémon TCG Pocket")).toBe("pocket");
    expect(pokemon("P-A", "Promos-A", "Pokémon TCG Pocket")).toBe("pocket"); // Pocket beats promo
    expect(pokemon("B2a", "Paldean Wonders")).toBe("pocket"); // even without a series
  });

  it("basic-energy sets are other", () => {
    expect(pokemon("sve", "Scarlet & Violet Energy", "Scarlet & Violet")).toBe("other");
    expect(pokemon("mee", "Mega Evolution Energy", "Mega Evolution")).toBe("other");
  });

  it("other games have only main sets until they get rules", () => {
    expect(classifySet({ game: "yugioh", code: "LOB", name: "Legend of Blue Eyes" })).toBe("main");
    expect(classifySet({ game: "one-piece", code: "OP01", name: "Romance Dawn" })).toBe("main");
  });
});

describe("specialSections", () => {
  it("families of 3+ get their own section; smaller ones merge with other", () => {
    expect(
      specialSections({
        main: 150,
        promo: 10,
        mcdonalds: 12,
        "trainer-kit": 2,
        pocket: 15,
        other: 1,
      }),
    ).toEqual([
      { key: "promo", label: "Promos", categories: ["promo"] },
      { key: "mcdonalds", label: "McDonald's Collection", categories: ["mcdonalds"] },
      { key: "pocket", label: "Pokémon TCG Pocket (digital only)", categories: ["pocket"] },
      { key: "other", label: "Other & special", categories: ["trainer-kit", "other"] },
    ]);
  });

  it("leaves out empty sections", () => {
    expect(specialSections({ main: 10 })).toEqual([]);
    expect(specialSections({ other: 2 })).toEqual([
      { key: "other", label: "Other & special", categories: ["other"] },
    ]);
  });
});
