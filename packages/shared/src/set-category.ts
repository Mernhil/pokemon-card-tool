/**
 * Which kind of set a set is, so the regular expansions stay front and
 * center and the odd ones ("Black Star" promos, McDonald's, trainer kits,
 * digital-only Pocket sets, ...) live in their own sections.
 *
 * Per game: add a rules function to RULES to give another game categories;
 * games without rules have only "main" sets. Stored as Set.category and
 * recomputed on every catalog sync upsert (and backfilled at startup).
 */

export const SET_CATEGORIES = [
  "main",
  "promo",
  "mcdonalds",
  "trainer-kit",
  "pocket",
  "other",
] as const;
export type SetCategory = (typeof SET_CATEGORIES)[number];

export const SET_CATEGORY_LABELS: Record<SetCategory, string> = {
  main: "Main sets",
  promo: "Promos",
  mcdonalds: "McDonald's Collection",
  "trainer-kit": "Trainer kits & battle decks",
  pocket: "Pokémon TCG Pocket (digital only)",
  other: "Other & special",
};

/** Short label for badges next to a set name; null for main sets. */
export const SET_CATEGORY_BADGES: Record<SetCategory, string | null> = {
  main: null,
  promo: "Promo",
  mcdonalds: "McDonald's",
  "trainer-kit": "Trainer kit",
  pocket: "Pocket",
  other: "Special",
};

export function isSetCategory(value: unknown): value is SetCategory {
  return typeof value === "string" && (SET_CATEGORIES as readonly string[]).includes(value);
}

export interface ClassifyInput {
  game: string;
  code: string;
  name: string;
  series?: string | null;
}

/**
 * Exceptions, keyed by `${game}:${code}`: sets whose category can't be told
 * from their series or name. Everything else goes through the rules below.
 */
export const SET_CATEGORY_OVERRIDES: Record<string, SetCategory> = {
  // Promotional / giveaway sets TCGdex files under regular series.
  "pokemon:wp": "promo", // W Promotional
  "pokemon:sp": "promo", // Sample
  "pokemon:bog": "promo", // Best of game
  "pokemon:si1": "promo", // Southern Islands
  "pokemon:fut2020": "promo", // Pokémon Futsal 2020
  "pokemon:ex5.5": "promo", // Poké Card Creator Pack
  "pokemon:exu": "promo", // Unseen Forces Unown Collection
  "pokemon:xya": "promo", // Yellow A Alternate
  // Two ready-to-play decks rather than an expansion.
  "pokemon:mfb": "trainer-kit", // My First Battle
  // Oversize cards: real, but not something you complete.
  "pokemon:jumbo": "other", // Jumbo cards
};

type Rules = (input: ClassifyInput) => SetCategory;

const POCKET_CODE = /^(A\d+[a-z]?|B\d+[a-z]?|P-A)$/;
const PROMO_NAME = /black star promos?|\bpromos?\b|promotional/i;
const TRAINER_KIT_NAME = /trainer kit|battle deck|battle academy|starter deck/i;
const ENERGY_NAME = /\benergy$/i;

const pokemonRules: Rules = ({ code, name, series }) => {
  if (series === "Pokémon TCG Pocket" || POCKET_CODE.test(code)) return "pocket";
  if (series === "McDonald's Collection" || /^mcdonald/i.test(name)) return "mcdonalds";
  if (series === "Trainer kits" || TRAINER_KIT_NAME.test(name)) return "trainer-kit";
  if (series === "POP" || PROMO_NAME.test(name)) return "promo";
  // The tcgcsv-fed promo catalogs ("EN-…", "JP-…"): blister / deck / league / prize-pack cards and the like.
  if (series === "Promos & events" || series === "Japanese promos" || /^(EN|JP)-/.test(code))
    return "promo";
  if (ENERGY_NAME.test(name)) return "other";
  return "main";
};

const RULES: Record<string, Rules> = { pokemon: pokemonRules };

/** Pure: the category for a set. Unknown games and unmatched sets are "main". */
export function classifySet(input: ClassifyInput): SetCategory {
  const override = SET_CATEGORY_OVERRIDES[`${input.game}:${input.code}`];
  if (override) return override;
  return RULES[input.game]?.(input) ?? "main";
}

// ---------- sections ----------

/** A family needs at least this many sets to get a section of its own. */
export const MIN_FAMILY_SIZE = 3;

export interface SetSection {
  /** Stable key for remembering collapsed state. */
  key: string;
  label: string;
  categories: SetCategory[];
}

/**
 * Pure: which collapsible sections the special (non-main) sets are shown in.
 * A special family with {@link MIN_FAMILY_SIZE}+ sets gets its own section;
 * smaller families merge with "other" into one "Other & special" section.
 * `counts` is sets per category; empty sections are left out.
 */
export function specialSections(counts: Partial<Record<SetCategory, number>>): SetSection[] {
  const order: SetCategory[] = ["promo", "mcdonalds", "trainer-kit", "pocket"];
  const sections: SetSection[] = [];
  const merged: SetCategory[] = [];
  for (const category of order) {
    const n = counts[category] ?? 0;
    if (n === 0) continue;
    if (n >= MIN_FAMILY_SIZE)
      sections.push({
        key: category,
        label: SET_CATEGORY_LABELS[category],
        categories: [category],
      });
    else merged.push(category);
  }
  if ((counts.other ?? 0) > 0) merged.push("other");
  if (merged.length > 0)
    sections.push({ key: "other", label: SET_CATEGORY_LABELS.other, categories: merged });
  return sections;
}
