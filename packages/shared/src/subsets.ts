/**
 * Sub-collections inside one set ("subsets"), like the filter tabs on the
 * official 30th Celebration gallery: Pokémon ex, Special Art, Pikachu Rare,
 * Classic Collection, Futuristic Rare. A subset is only a label on a printing
 * (Printing.subset); a set without an entry here has no subsets and looks
 * exactly as before.
 *
 * To give another set subsets, add one entry to SUBSET_RULES — nothing else.
 * Rules are checked in order; the first that matches wins; a printing matching
 * none has no subset (it only shows under "See all").
 */

export interface SubsetRule {
  subset: string;
  /** Matches when the printing's rarity name is one of these (case-insensitive). */
  rarity?: string[];
  /** Matches when the printing's collector number matches this. */
  collectorNumber?: RegExp;
}

export interface SetSubsets {
  /** Tab order. */
  order: string[];
  rules: SubsetRule[];
}

/** Keyed by Set.code. */
export const SUBSET_RULES: Record<string, SetSubsets> = {
  // Data checked against the synced set (TCGdex): rarities "Double rare" (the ex cards),
  // "Illustration rare" + "Special illustration rare" (Special Art), "Pikachu Rare",
  // "Futuristic Rare"; the Classic Collection's 30 reprints are numbered "NNN/30"
  // (the main cards are "NNN/128" or "NNN" without a total).
  "30th": {
    order: ["Pokémon ex", "Special Art", "Pikachu Rare", "Classic Collection", "Futuristic Rare"],
    rules: [
      { subset: "Classic Collection", collectorNumber: /\/30$/ },
      { subset: "Pikachu Rare", rarity: ["Pikachu Rare"] },
      { subset: "Futuristic Rare", rarity: ["Futuristic Rare"] },
      { subset: "Special Art", rarity: ["Illustration rare", "Special illustration rare"] },
      { subset: "Pokémon ex", rarity: ["Double rare"] },
    ],
  },
};

export interface SubsetInput {
  setCode: string;
  collectorNumber: string;
  rarityName?: string | null;
  name?: string | null;
}

/** Pure: the subset a printing belongs to, or null (no subsets for the set / no rule matches). */
export function subsetFor(input: SubsetInput): string | null {
  const entry = SUBSET_RULES[input.setCode];
  if (!entry) return null;
  const rarity = input.rarityName?.trim().toLowerCase();
  for (const rule of entry.rules) {
    if (rule.collectorNumber && rule.collectorNumber.test(input.collectorNumber)) return rule.subset;
    if (rule.rarity && rarity && rule.rarity.some((r) => r.toLowerCase() === rarity))
      return rule.subset;
  }
  return null;
}

/** The subset tabs for a set, in order; empty when it has none. */
export function subsetsForSet(setCode: string): string[] {
  return SUBSET_RULES[setCode]?.order ?? [];
}

/**
 * A set some sources list separately although it belongs inside another:
 * TCGdex has "30th-c" (Classic Collection) next to "30th". Its cards are
 * stored in the parent set (sort numbers shifted so they follow the parent's
 * own cards), and no set of its own is created.
 */
export interface SetMerge {
  into: string;
  /** Added to the merged cards' sort numbers. */
  sortOffset: number;
}

/** Keyed by `${game}:${code}`. */
export const SET_MERGES: Record<string, SetMerge> = {
  "pokemon:30th-c": { into: "30th", sortOffset: 1000 },
};

export function mergeTarget(game: string, code: string): SetMerge | null {
  return SET_MERGES[`${game}:${code}`] ?? null;
}
