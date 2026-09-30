import { describe, expect, it } from "vitest";
import { compareGradeKeys, gradeKey, gradeLabel, parseGradedTitle } from "./grading";

describe("parseGradedTitle", () => {
  it.each([
    ["Charizard 4/102 Base Set PSA 10 GEM MINT", "PSA", 10, ""],
    ["PSA 9 Pikachu 025/165", "PSA", 9, ""],
    ["Mew ex 232/091 BGS 9.5 Gem Mint", "BGS", 9.5, ""],
    ["Beckett BGS 10 Black Label Charizard", "BGS", 10, "black-label"],
    ["BGS 10 Pristine Umbreon VMAX", "BGS", 10, "pristine"],
    ["CGC Pristine 10 Lugia 9/111", "CGC", 10, "pristine"],
    ["CGC 10 Gem Mint Lugia", "CGC", 10, ""],
    ["CGC 8.5 NM/Mint+ Blastoise", "CGC", 8.5, ""],
    ["SGC 10 Gold Label Gengar", "SGC", 10, ""],
    ["TAG 10 Pristine Rayquaza", "TAG", 10, "pristine"],
    ["Mewtwo PSA: 8", "PSA", 8, ""],
  ])("%s", (title, company, grade, tier) => {
    expect(parseGradedTitle(title)).toEqual({ company, grade, tier });
  });

  it("only gives Black Label to BGS, and Pristine to BGS/CGC/TAG", () => {
    expect(parseGradedTitle("PSA 10 black label style")?.tier).toBe("");
    expect(parseGradedTitle("PSA 10 pristine condition")?.tier).toBe("");
  });

  it("is not fooled by card numbers or ungraded titles", () => {
    expect(parseGradedTitle("Charizard ex 199/165 PSA ready")).toBeNull();
    expect(parseGradedTitle("PSA 001/064 Pikachu")).toBeNull();
    expect(parseGradedTitle("Charizard ex NM raw ungraded")).toBeNull();
    expect(parseGradedTitle("Pikachu PSA 11")).toBeNull();
    expect(parseGradedTitle("Pikachu PSA 7.3")).toBeNull();
  });
});

describe("grade keys", () => {
  it("labels and sorts high to low, premium tiers first", () => {
    expect(gradeLabel(gradeKey(10, "black-label"))).toBe("10 Black Label");
    expect(gradeLabel(gradeKey(9.5, ""))).toBe("9.5");
    const keys = ["9", "10", "10:pristine", "10:black-label", "9.5"];
    expect(keys.sort(compareGradeKeys)).toEqual(["10:black-label", "10:pristine", "10", "9.5", "9"]);
  });
});
