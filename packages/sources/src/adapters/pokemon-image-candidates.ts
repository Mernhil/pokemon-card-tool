/**
 * Direct CDN image URLs for a Pokémon printing, built from ids alone — no API
 * call — so a card the primary source lists without an image (or whose
 * listed image 404s) can still be tried on the other free CDNs.
 *
 * - TCGdex assets: https://assets.tcgdex.net/en/<series id>/<set id>/<local id>/high.webp
 *   (the API's `image` field is exactly that path without the variant suffix).
 * - pokemontcg.io: https://images.pokemontcg.io/<set id>/<number>_hires.png
 *   Its set ids differ from TCGdex's ("sv8pt5" vs "sv08.5"), see {@link pokemontcgIoSetId}.
 */

const TCGDEX_ASSETS = "https://assets.tcgdex.net";
const POKEMONTCG_IO_IMAGES = "https://images.pokemontcg.io";

/** TCGdex series name -> series id, as used in its asset paths. */
const TCGDEX_SERIES_IDS: Record<string, string> = {
  Miscellaneous: "misc",
  Base: "base",
  Gym: "gym",
  Neo: "neo",
  "Legendary Collection": "lc",
  "E-Card": "ecard",
  EX: "ex",
  POP: "pop",
  "Trainer kits": "tk",
  "Diamond & Pearl": "dp",
  Platinum: "pl",
  "HeartGold & SoulSilver": "hgss",
  "Call of Legends": "col",
  "Black & White": "bw",
  "McDonald's Collection": "mc",
  XY: "xy",
  "Sun & Moon": "sm",
  "Sword & Shield": "swsh",
  "Scarlet & Violet": "sv",
  "Pokémon TCG Pocket": "tcgp",
  "Mega Evolution": "me",
};

/**
 * TCGdex set code -> pokemontcg.io set id, where the generic rule in
 * {@link pokemontcgIoSetId} doesn't give the right one. Sets pokemontcg.io
 * doesn't have (Pocket, trainer kits, ...) simply yield URLs that 404 and are
 * skipped (and remembered as missing for a while).
 */
const POKEMONTCG_IO_SET_IDS: Record<string, string> = {
  "swsh3.5": "swsh35",
  "swsh4.5": "swsh45",
  "swsh4.5sv": "swsh45sv",
  "swsh10.5": "pgo",
  "swsh12.5": "swsh12pt5",
  "swsh12.5gg": "swsh12pt5gg",
  "sm3.5": "sm35",
  "sm7.5": "sm75",
  "sv10.5b": "zsv10pt5",
  "sv10.5w": "rsv10pt5",
  cel25cc: "cel25c",
  "2011bw": "mcd11",
  "2012bw": "mcd12",
  "2014xy": "mcd14",
  "2015xy": "mcd15",
  "2016xy": "mcd16",
  "2017sm": "mcd17",
  "2018sm": "mcd18",
  "2019sm": "mcd19",
  "2021swsh": "mcd21",
  "2022swsh": "mcd22",
  "2023sv": "mcd23",
  "2024sv": "mcd24",
};

/**
 * Pure: pokemontcg.io's set id for a TCGdex set code. Generic rule: drop the
 * zero padding of the set number ("sv01" -> "sv1") and spell a ".5" half-set
 * "pt5" ("sv03.5" -> "sv3pt5"); everything else is the same id.
 */
export function pokemontcgIoSetId(tcgdexCode: string): string {
  const code = tcgdexCode.trim();
  const override = POKEMONTCG_IO_SET_IDS[code];
  if (override) return override;
  const half = code.match(/^([a-z]+)0*(\d+)\.5$/i);
  if (half) return `${half[1]!.toLowerCase()}${half[2]}pt5`;
  const plain = code.match(/^([a-z]+)0*(\d+)$/i);
  if (plain) return `${plain[1]!.toLowerCase()}${plain[2]}`;
  return code.toLowerCase();
}

export interface PokemonImageInput {
  /** TCGdex set code ("sv08.5"). */
  setCode: string;
  /** TCGdex series name ("Scarlet & Violet"), if known. */
  series?: string | null;
  /** "4/102" or just "4". */
  collectorNumber: string;
  /** The set's printed card count, to spot galleries numbered outside it ("001/30" in a 128-card set). */
  printedTotal?: number | null;
}

function localIdOf(collectorNumber: string): string {
  return (collectorNumber.split("/")[0] ?? collectorNumber).trim();
}

/** Pure: TCGdex's own asset variants for a card, best first (empty when the series id is unknown). */
export function tcgdexAssetUrls(input: PokemonImageInput): string[] {
  const seriesId = input.series ? TCGDEX_SERIES_IDS[input.series] : undefined;
  const localId = localIdOf(input.collectorNumber);
  if (!seriesId || !localId) return [];
  const base = `${TCGDEX_ASSETS}/en/${seriesId}/${input.setCode}/${localId}`;
  return [`${base}/high.webp`, `${base}/high.png`, `${base}/low.webp`];
}

/** Pure: pokemontcg.io's CDN URLs for a card, best first. */
export function pokemontcgIoImageUrls(input: PokemonImageInput): string[] {
  const localId = localIdOf(input.collectorNumber);
  if (!localId) return [];
  const base = `${POKEMONTCG_IO_IMAGES}/${pokemontcgIoSetId(input.setCode)}/${localId}`;
  return [`${base}_hires.png`, `${base}.png`];
}

/**
 * Pure: every image URL worth trying for a Pokémon printing, without any
 * network call. `known` (what the catalog stored, best first) always comes
 * first; the constructed candidates follow, duplicates removed.
 */
export function pokemonImageCandidates(input: PokemonImageInput, known: string[] = []): string[] {
  // A "001/30" card in a 128-card set is a gallery TCGdex files as its own set: the constructed
  // addresses would show the main set's card 001 instead.
  const total = Number(input.collectorNumber.split("/")[1]);
  if (total && input.printedTotal && total !== input.printedTotal) return [...new Set(known)];
  return [...new Set([...known, ...tcgdexAssetUrls(input), ...pokemontcgIoImageUrls(input)])];
}
