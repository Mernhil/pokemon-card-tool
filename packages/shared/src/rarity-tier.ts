/**
 * Coarse rarity tiers, so a search can separate "normal / holo" cards from
 * the expensive ones without knowing every set's rarity names. Per game:
 * only Pokémon has rules so far; other games return null (no tier) and the
 * tier filter simply isn't offered for them.
 */

export const RARITY_TIERS = ["common", "rare", "holo-rare", "ultra", "special"] as const;
export type RarityTier = (typeof RARITY_TIERS)[number];

export const RARITY_TIER_LABELS: Record<RarityTier, string> = {
  common: "Common / Uncommon",
  rare: "Rare",
  "holo-rare": "Holo rare",
  ultra: "Ultra rare",
  special: "Special / Illustration / Secret",
};

export function isRarityTier(value: unknown): value is RarityTier {
  return typeof value === "string" && (RARITY_TIERS as readonly string[]).includes(value);
}

function pokemonTier(name: string): RarityTier | null {
  const n = name.trim().toLowerCase();
  if (!n || n === "none" || n === "unknown" || n === "promo" || n === "classic collection")
    return null;
  // The chase cards: special art, secret / hyper / rainbow / gold, shiny, amazing, crown.
  if (
    /illustration|secret|hyper|rainbow|gold|crown|shiny|amazing|black white rare|mega attack|rgb/.test(
      n,
    )
  )
    return "special";
  // Rule-box and full-art cards: ex / GX / V / VMAX / VSTAR / LV.X / BREAK / Prime / Legend, ultra, ACE SPEC, radiant.
  if (
    /ultra|double rare|triple rare|ace spec|radiant|full art|\b(ex|gx|v|vmax|vstar|v-union|lv\.?x|break|prime|legend|star)\b/.test(
      n,
    )
  )
    return "ultra";
  if (/holo/.test(n)) return "holo-rare";
  if (/^(common|uncommon)$/.test(n)) return "common";
  if (/rare/.test(n)) return "rare";
  return null;
}

const RULES: Record<string, (name: string) => RarityTier | null> = { pokemon: pokemonTier };

/** Pure: a rarity name's tier, or null when the game has no rules or the name doesn't fit one. */
export function rarityTier(game: string, rarityName: string | null | undefined): RarityTier | null {
  if (!rarityName) return null;
  return RULES[game]?.(rarityName) ?? null;
}

/** Whether a game has tiers at all (the tier filter is only offered then). */
export function hasRarityTiers(game: string): boolean {
  return game in RULES;
}
