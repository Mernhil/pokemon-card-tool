import { describe, expect, it } from "vitest";
import { hasRarityTiers, rarityTier } from "./rarity-tier";

const t = (name: string | null) => rarityTier("pokemon", name);

describe("rarityTier (Pokémon, real TCGdex rarity names)", () => {
  it("common and uncommon", () => {
    expect(t("Common")).toBe("common");
    expect(t("Uncommon")).toBe("common");
  });

  it("plain rare, and holo rare", () => {
    expect(t("Rare")).toBe("rare");
    expect(t("Rare Holo")).toBe("holo-rare");
    expect(t("Holo Rare")).toBe("holo-rare");
  });

  it("rule-box and full-art cards are ultra", () => {
    expect(t("Double rare")).toBe("ultra");
    expect(t("Ultra Rare")).toBe("ultra");
    expect(t("Holo Rare V")).toBe("ultra");
    expect(t("Holo Rare VMAX")).toBe("ultra");
    expect(t("Rare Holo LV.X")).toBe("ultra");
    expect(t("ACE SPEC Rare")).toBe("ultra");
    expect(t("Radiant Rare")).toBe("ultra");
  });

  it("special art, secret, hyper, shiny and amazing rares are special", () => {
    expect(t("Illustration rare")).toBe("special");
    expect(t("Special illustration rare")).toBe("special");
    expect(t("Secret Rare")).toBe("special");
    expect(t("Hyper rare")).toBe("special");
    expect(t("Shiny rare")).toBe("special");
    expect(t("Amazing Rare")).toBe("special");
    expect(t("Crown")).toBe("special");
  });

  it("names that fit no tier, and missing names, have none", () => {
    expect(t("None")).toBeNull();
    expect(t("Promo")).toBeNull();
    expect(t(null)).toBeNull();
    expect(t("")).toBeNull();
  });

  it("only games with rules have tiers", () => {
    expect(rarityTier("yugioh", "Secret Rare")).toBeNull();
    expect(hasRarityTiers("pokemon")).toBe(true);
    expect(hasRarityTiers("one-piece")).toBe(false);
  });
});
