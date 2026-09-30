import { describe, expect, it } from "vitest";
import { mergeTarget, subsetFor, subsetsForSet } from "./subsets";

const s30 = (collectorNumber: string, rarityName: string | null, name = "Card") =>
  subsetFor({ setCode: "30th", collectorNumber, rarityName, name });

describe("subsetFor (30th Celebration, real cards)", () => {
  it("Classic Collection reprints are numbered NNN/30 and have no rarity", () => {
    expect(s30("001/30", null, "Charizard")).toBe("Classic Collection");
    expect(s30("030/30", "None", "Mew")).toBe("Classic Collection");
  });

  it("maps the official tabs from rarity names", () => {
    expect(s30("023/128", "Pikachu Rare", "Pikachu")).toBe("Pikachu Rare");
    expect(s30("157", "Futuristic Rare")).toBe("Futuristic Rare");
    expect(s30("147", "Special illustration rare")).toBe("Special Art");
    expect(s30("129", "Illustration rare")).toBe("Special Art");
    expect(s30("015/128", "Double rare", "Mega Gardevoir ex")).toBe("Pokémon ex");
  });

  it("commons, rares and RGB rares belong to no subset (only 'See all')", () => {
    expect(s30("001/128", "Common", "Exeggcute")).toBeNull();
    expect(s30("012/128", "Rare")).toBeNull();
    expect(s30("R", "RGB Rare")).toBeNull();
    expect(s30("001/128", null)).toBeNull();
  });

  it("is case-insensitive about rarity names", () => {
    expect(s30("147", "SPECIAL ILLUSTRATION RARE")).toBe("Special Art");
  });

  it("a set without rules has no subsets at all", () => {
    expect(
      subsetFor({ setCode: "sv01", collectorNumber: "001/198", rarityName: "Double rare" }),
    ).toBeNull();
    expect(subsetsForSet("sv01")).toEqual([]);
  });

  it("tab order matches the official gallery", () => {
    expect(subsetsForSet("30th")).toEqual([
      "Pokémon ex",
      "Special Art",
      "Pikachu Rare",
      "Classic Collection",
      "Futuristic Rare",
    ]);
  });
});

describe("mergeTarget", () => {
  it("the stray Classic Collection set belongs inside 30th Celebration", () => {
    expect(mergeTarget("pokemon", "30th-c")).toEqual({ into: "30th", sortOffset: 1000 });
    expect(mergeTarget("pokemon", "30th")).toBeNull();
    expect(mergeTarget("yugioh", "30th-c")).toBeNull();
  });
});
