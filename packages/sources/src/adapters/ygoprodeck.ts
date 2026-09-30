import type {
  CatalogSourceAdapter,
  SourcePrinting,
  SourceSet,
  SourceSetSummary,
} from "../types";

/**
 * YGOPRODeck's free public API (https://ygoprodeck.com/api-guide/). No API
 * key required. `cardsets.php` lists every set once; `cardinfo.php?cardset=`
 * filters by the set's exact display name (not its short code), so the
 * adapter caches the set list to resolve one to the other.
 */
const YGOPRODECK_BASE = "https://db.ygoprodeck.com/api/v7";

export interface YgoprodeckSet {
  set_name: string;
  set_code: string;
  num_of_cards: number;
  tcg_date?: string;
  /** cardsets.php: URL of the set's pack/box art. */
  set_image?: string;
  /**
   * Our unique set code. cardsets.php reuses `set_code` for several sets
   * (every "Sneak Peek" / "Special Edition" / tin variant shares its parent's),
   * which broke the (game, code) uniqueness; see {@link withUniqueSetCodes}.
   */
  code?: string;
}

export interface YgoprodeckCardSetEntry {
  set_name: string;
  set_code: string;
  set_rarity?: string;
  set_rarity_code?: string;
  set_price?: string;
}

export interface YgoprodeckCardImage {
  id: number;
  image_url: string;
  image_url_small?: string;
  image_url_cropped?: string;
}

export interface YgoprodeckCard {
  id: number;
  name: string;
  type: string;
  desc: string;
  race?: string;
  attribute?: string;
  atk?: number;
  def?: number;
  level?: number;
  scale?: number;
  linkval?: number;
  linkmarkers?: string[];
  archetype?: string;
  card_sets?: YgoprodeckCardSetEntry[];
  card_images?: YgoprodeckCardImage[];
}

/**
 * Pure: gives every cardsets.php row a unique `code`. Rows sharing a
 * `set_code` are ordered by name length then name; the first keeps the plain
 * code (it's the "main" set, e.g. "Absolute Powerforce"), the others become
 * "CODE~slug-of-name". Deterministic, so re-syncs map to the same Set rows.
 */
export function withUniqueSetCodes(sets: YgoprodeckSet[]): YgoprodeckSet[] {
  const groups = new Map<string, YgoprodeckSet[]>();
  for (const s of sets) groups.set(s.set_code, [...(groups.get(s.set_code) ?? []), s]);
  const codes = new Map<YgoprodeckSet, string>();
  for (const [code, group] of groups) {
    const sorted = [...group].sort(
      (a, b) => a.set_name.length - b.set_name.length || a.set_name.localeCompare(b.set_name),
    );
    sorted.forEach((s, i) => {
      const slug = s.set_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      codes.set(s, i === 0 ? code : `${code}~${slug}`);
    });
  }
  return sets.map((s) => ({ ...s, code: codes.get(s) }));
}

/** Pure, network-free: a cardsets.php row -> our SourceSetSummary. */
export function mapYgoprodeckSetSummary(set: YgoprodeckSet): SourceSetSummary {
  return { code: set.code ?? set.set_code, name: set.set_name, totalCards: set.num_of_cards };
}

/** Pure, network-free: a cardsets.php row -> our SourceSet. */
export function mapYgoprodeckSet(set: YgoprodeckSet): SourceSet {
  return {
    code: set.code ?? set.set_code,
    name: set.set_name,
    releaseDate: set.tcg_date,
    printedTotal: set.num_of_cards,
    totalCards: set.num_of_cards,
  };
}

/**
 * Pure, network-free: one cardinfo.php card -> one SourcePrinting per
 * `card_sets` entry that belongs to `setName` (a card can be reprinted
 * across sets, and even appear at more than one rarity within the same set).
 * Returns [] when the card has no entry for this set.
 */
export function ygoprodeckPrintingsForSet(
  card: YgoprodeckCard,
  setName: string,
): SourcePrinting[] {
  const entries = (card.card_sets ?? []).filter((entry) => entry.set_name === setName);
  if (entries.length === 0) return [];

  const attributes: Record<string, unknown> = {};
  if (card.desc) attributes.effect = card.desc;
  if (card.race) attributes.race = card.race;
  if (card.attribute) attributes.attribute = card.attribute;
  if (card.atk !== undefined) attributes.atk = card.atk;
  if (card.def !== undefined) attributes.def = card.def;
  if (card.level !== undefined) attributes.level = card.level;
  if (card.scale !== undefined) attributes.scale = card.scale;
  if (card.linkval !== undefined) attributes.linkval = card.linkval;
  if (card.linkmarkers) attributes.linkmarkers = card.linkmarkers;
  if (card.archetype) attributes.archetype = card.archetype;

  const imageUrls = card.card_images?.[0]?.image_url ? [card.card_images[0].image_url] : undefined;

  return entries.map((entry) => ({
    externalCardId: `${card.id}-${entry.set_code}`,
    cardName: card.name,
    cardType: card.type,
    subtypes: [],
    collectorNumber: entry.set_code,
    rarityName: entry.set_rarity,
    imageUrls,
    attributes,
  }));
}

/** Thrown internally when the API's 400-with-error-body means "no matches", not a real failure. */
class NotFound extends Error {}

/**
 * Catalog adapter for Yu-Gi-Oh backed by YGOPRODeck. See
 * packages/db/src/sync-catalog.ts for the CLI that drives this to populate
 * Set/Card/Printing/PrintVariant.
 */
export class YgoprodeckAdapter implements CatalogSourceAdapter {
  readonly slug = "ygoprodeck-yugioh";
  readonly game = "yugioh";
  readonly languageCode = "en";
  private readonly fetchImpl: typeof fetch;
  private setsCache: Promise<YgoprodeckSet[]> | null = null;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  private async fetchJson<T>(url: string, notFoundStatus?: number): Promise<T> {
    const res = await this.fetchImpl(url);
    if (res.status === 200) return (await res.json()) as T;
    if (notFoundStatus !== undefined && res.status === notFoundStatus) throw new NotFound();
    throw new Error(`YGOPRODeck request failed: ${url} -> HTTP ${res.status}`);
  }

  private allSets(): Promise<YgoprodeckSet[]> {
    if (!this.setsCache) {
      this.setsCache = this.fetchJson<YgoprodeckSet[]>(`${YGOPRODECK_BASE}/cardsets.php`).then(
        withUniqueSetCodes,
      );
    }
    return this.setsCache;
  }

  async listSets(): Promise<SourceSet[]> {
    return (await this.allSets()).map(mapYgoprodeckSet);
  }

  async getSet(setCode: string): Promise<SourceSet | null> {
    const entry = (await this.allSets()).find((s) => s.code === setCode);
    return entry ? mapYgoprodeckSet(entry) : null;
  }

  /** Every set, newest first (undated sets last), for pickers. */
  async listSetSummaries(): Promise<SourceSetSummary[]> {
    const sets = await this.allSets();
    if (sets.length === 0) throw new Error("YGOPRODeck returned an empty set list");
    return [...sets]
      .sort((a, b) => (b.tcg_date ?? "").localeCompare(a.tcg_date ?? ""))
      .map(mapYgoprodeckSetSummary);
  }

  async listPrintings(setCode: string): Promise<SourcePrinting[]> {
    const entry = (await this.allSets()).find((s) => s.code === setCode);
    if (!entry) return [];

    let cards: YgoprodeckCard[];
    try {
      const res = await this.fetchJson<{ data: YgoprodeckCard[] }>(
        `${YGOPRODECK_BASE}/cardinfo.php?cardset=${encodeURIComponent(entry.set_name)}`,
        400,
      );
      cards = res.data ?? [];
    } catch (err) {
      if (err instanceof NotFound) return [];
      throw err;
    }

    const printings: SourcePrinting[] = [];
    for (const card of cards) printings.push(...ygoprodeckPrintingsForSet(card, entry.set_name));
    return printings;
  }
}
