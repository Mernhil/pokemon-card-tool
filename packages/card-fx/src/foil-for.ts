import { FOIL_PRESETS, type FoilPreset } from "./presets";

/**
 * Holo foil is vaulted (shelved): the overlay couldn't be made to match the
 * reference look yet. Flip to true to render the foil layers again; all the
 * presets, CSS and foilFor logic are kept intact.
 */
export const FOIL_ENABLED = false;

/**
 * Where on the card the foil sits:
 * - "art": only the illustration window (classic holo rare)
 * - "frame": everything *except* the illustration window (reverse holo)
 * - "full": the whole card (full arts, illustration rares, gold, …)
 * - "none": no foil, only the glare of light on the card surface
 */
export type FoilArea = "art" | "frame" | "full" | "none";

export interface CardFoil {
  preset: FoilPreset;
  area: FoilArea;
}

/**
 * Illustration window of a modern Pokémon card, as fractions of the card
 * (top, right, bottom, left insets). Approximate but close for SV/SWSH and
 * most older layouts; only used to place the holo/reverse sheen.
 */
export const POKEMON_ART_WINDOW = { top: 0.11, right: 0.08, bottom: 0.5, left: 0.08 } as const;

/** Rarity names (TCGdex / printed) whose whole card is foil and textured. */
const FULL_ART =
  /illustration|ultra|full art|rainbow|shiny|secret|hyper|gold|vmax|vstar|amazing|ace spec|trainer gallery|radiant/i;
const GOLD = /hyper|gold/i;

/**
 * Pure: which foil preset and area to render for one variant of a printing.
 * The variant's finish decides first (a reverse holo is a reverse holo
 * whatever its rarity); for the card's "main" foil version the rarity picks
 * between a classic holo window and a full-card textured foil.
 */
export function foilFor(finish: string, rarityName?: string | null): CardFoil {
  const rarity = rarityName ?? "";
  const preset = (slug: string) => FOIL_PRESETS[slug]!;

  if (finish === "REVERSE_HOLO") return { preset: preset("reverse-holo"), area: "frame" };

  if (FULL_ART.test(rarity)) {
    return { preset: preset(GOLD.test(rarity) ? "gold" : "full-art-textured"), area: "full" };
  }

  if (finish === "HOLO") return { preset: preset("holo"), area: "art" };
  if (finish === "COSMOS_HOLO") return { preset: preset("cosmos"), area: "art" };
  if (finish === "GOLD") return { preset: preset("gold"), area: "full" };
  if (finish !== "NON_FOIL" && finish !== "") {
    // Any other special finish: treat as a full-card foil.
    return { preset: preset("full-art-textured"), area: "full" };
  }
  return { preset: preset("non-foil"), area: "none" };
}
