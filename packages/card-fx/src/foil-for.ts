import { FOIL_PRESETS, type FoilPreset } from "./presets";

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

/**
 * `Finish` (packages/shared/src/enums.ts) values that already say exactly
 * what the card's foil looks like, so they win outright over rarity-name
 * guessing — kept in sync with FOIL_PRESETS (checked by presets.test.ts).
 * NON_FOIL and HOLO are deliberately absent: they're the two overloaded
 * buckets our only live source (TCGdex) reports for *everything* from a
 * plain rare holo to a secret rainbow rare, so those two still fall through
 * to the rarity-name rules below to tell them apart.
 */
const UNAMBIGUOUS_FINISH: Record<string, CardFoil> = {
  REVERSE_HOLO: { preset: FOIL_PRESETS["reverse-holo"]!, area: "frame" },
  COSMOS_HOLO: { preset: FOIL_PRESETS.cosmos!, area: "art" },
  CRACKED_ICE: { preset: FOIL_PRESETS["cracked-ice"]!, area: "full" },
  FULL_ART_TEXTURED: { preset: FOIL_PRESETS["full-art-textured"]!, area: "full" },
  RAINBOW: { preset: FOIL_PRESETS.rainbow!, area: "full" },
  GOLD: { preset: FOIL_PRESETS.gold!, area: "full" },
  ETCHED: { preset: FOIL_PRESETS.etched!, area: "full" },
  PARALLEL: { preset: FOIL_PRESETS.parallel!, area: "full" },
  SECRET_TEXTURED: { preset: FOIL_PRESETS["secret-textured"]!, area: "full" },
  ULTIMATE: { preset: FOIL_PRESETS.ultimate!, area: "full" },
  GHOST: { preset: FOIL_PRESETS.ghost!, area: "full" },
  STARLIGHT: { preset: FOIL_PRESETS.starlight!, area: "full" },
  QUARTER_CENTURY: { preset: FOIL_PRESETS["quarter-century"]!, area: "full" },
  PRISMATIC: { preset: FOIL_PRESETS.prismatic!, area: "full" },
};

/**
 * Rarity name (TCGdex / printed) -> full-card preset slug, most specific
 * first. Real Pokémon rarities look wildly different from each other
 * (a Rainbow Rare is not a Gold Secret Rare is not an Amazing Rare), so this
 * is deliberately more than a two-way gold/generic split.
 */
const RARITY_PRESET: [RegExp, string][] = [
  [/rainbow/i, "rainbow"],
  [/prismatic/i, "prismatic"],
  [/starlight/i, "starlight"],
  [/quarter century|25th anniversary/i, "quarter-century"],
  [/hyper|gold/i, "gold"],
  [/shiny/i, "starlight"],
  [/radiant/i, "prismatic"],
  [/secret/i, "secret-textured"],
  [/illustration|ultra|full art|vmax|vstar|amazing|ace spec|trainer gallery/i, "full-art-textured"],
];

/**
 * Pure: which foil preset and area to render for one variant of a printing.
 *
 * An unambiguous `finish` always wins. For the two overloaded finishes
 * (HOLO, NON_FOIL) the rarity name decides between a classic windowed holo
 * and one of several full-card foil looks, since that's the only signal
 * TCGdex gives us for e.g. a Rainbow Rare vs. a Gold Secret Rare — both just
 * come back as finish "HOLO".
 */
export function foilFor(finish: string, rarityName?: string | null): CardFoil {
  const rarity = rarityName ?? "";
  const preset = (slug: string) => FOIL_PRESETS[slug]!;

  const unambiguous = UNAMBIGUOUS_FINISH[finish];
  if (unambiguous) return unambiguous;

  if (finish === "HOLO" || finish === "NON_FOIL" || finish === "OTHER" || finish === "") {
    const match = RARITY_PRESET.find(([re]) => re.test(rarity));
    if (match) return { preset: preset(match[1]), area: "full" };
    if (finish === "HOLO") return { preset: preset("holo"), area: "art" };
    if (finish !== "OTHER") return { preset: preset("non-foil"), area: "none" };
  }

  // Unrecognized finish string (not in `Finish` at all): still show *some*
  // foil rather than silently rendering flat, but don't guess a specific look.
  return { preset: preset("full-art-textured"), area: "full" };
}
