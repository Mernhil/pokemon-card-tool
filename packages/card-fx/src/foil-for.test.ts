import { describe, expect, it } from "vitest";
import { foilFor } from "./foil-for";

describe("foilFor", () => {
  it("puts a classic holo in the art window", () => {
    expect(foilFor("HOLO", "Rare")).toMatchObject({ area: "art", preset: { slug: "holo" } });
    expect(foilFor("HOLO", "Rare Holo")).toMatchObject({ area: "art" });
  });

  it("keeps reverse holos on the frame whatever the rarity", () => {
    expect(foilFor("REVERSE_HOLO", "Common")).toMatchObject({ area: "frame" });
    expect(foilFor("REVERSE_HOLO", "Illustration rare")).toMatchObject({ area: "frame" });
  });

  it("foils the whole card for full arts and illustration rares", () => {
    expect(foilFor("HOLO", "Special illustration rare")).toMatchObject({
      area: "full",
      preset: { slug: "full-art-textured" },
    });
    expect(foilFor("HOLO", "Ultra Rare")).toMatchObject({ area: "full" });
  });

  it("uses gold for hyper/gold rares", () => {
    expect(foilFor("HOLO", "Hyper rare")).toMatchObject({ area: "full", preset: { slug: "gold" } });
  });

  it("tells apart the different full-card rarities instead of one generic look", () => {
    expect(foilFor("HOLO", "Rainbow Rare")).toMatchObject({
      area: "full",
      preset: { slug: "rainbow" },
    });
    expect(foilFor("HOLO", "Shiny Rare")).toMatchObject({
      area: "full",
      preset: { slug: "starlight" },
    });
    expect(foilFor("HOLO", "Prismatic Rare")).toMatchObject({
      area: "full",
      preset: { slug: "prismatic" },
    });
    expect(foilFor("HOLO", "Secret Rare")).toMatchObject({
      area: "full",
      preset: { slug: "secret-textured" },
    });
  });

  it("trusts an unambiguous finish over the rarity name", () => {
    expect(foilFor("RAINBOW", "Common")).toMatchObject({
      area: "full",
      preset: { slug: "rainbow" },
    });
    expect(foilFor("CRACKED_ICE", null)).toMatchObject({
      area: "full",
      preset: { slug: "cracked-ice" },
    });
  });

  it("gives non-foil cards no foil at all", () => {
    expect(foilFor("NON_FOIL", "Common")).toMatchObject({
      area: "none",
      preset: { slug: "non-foil" },
    });
    expect(foilFor("NON_FOIL", null)).toMatchObject({ area: "none" });
  });
});
