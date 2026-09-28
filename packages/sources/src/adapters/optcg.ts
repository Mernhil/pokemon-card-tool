import type {
  CatalogSourceAdapter,
  SourcePrinting,
  SourceSet,
  SourceSetSummary,
} from "../types";

/**
 * optcgapi.com's free public API for the One Piece Card Game (no key
 * required, GET-only). `allSets/` lists every set as {set_name, set_id};
 * `sets/{set_id}/` returns every card printed in that set directly, so
 * unlike YGOPRODeck there's no separate name-resolution step.
 */
const OPTCG_BASE = "https://www.optcgapi.com/api";

export interface OptcgSet {
  set_name: string;
  set_id: string;
}

export interface OptcgCard {
  card_name: string;
  set_name: string;
  card_text?: string | null;
  set_id: string;
  rarity?: string | null;
  card_set_id: string;
  card_color?: string | null;
  card_type: string;
  life?: string | null;
  card_cost?: string | null;
  card_power?: string | null;
  sub_types?: string | null;
  counter_amount?: string | null;
  attribute?: string | null;
  card_image?: string | null;
}

/** Pure, network-free: an allSets/ row -> our SourceSet. */
export function mapOptcgSet(set: OptcgSet): SourceSet {
  return { code: set.set_id, name: set.set_name };
}

/** Pure, network-free: an allSets/ row -> our SourceSetSummary. */
export function mapOptcgSetSummary(set: OptcgSet): SourceSetSummary {
  return { code: set.set_id, name: set.set_name };
}

/** "Supernovas/Straw Hat Crew" -> ["Supernovas", "Straw Hat Crew"]. */
function splitSubTypes(subTypes: string | null | undefined): string[] {
  if (!subTypes) return [];
  return subTypes
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pure, network-free: one sets/{id}/ card -> our SourcePrinting. */
export function mapOptcgCardToSourcePrinting(card: OptcgCard): SourcePrinting {
  const attributes: Record<string, unknown> = {};
  if (card.card_text) attributes.effect = card.card_text;
  if (card.card_color) attributes.color = card.card_color;
  if (card.life) attributes.life = card.life;
  if (card.card_cost) attributes.cost = card.card_cost;
  if (card.card_power) attributes.power = card.card_power;
  if (card.counter_amount) attributes.counter = card.counter_amount;
  if (card.attribute) attributes.attribute = card.attribute;

  return {
    externalCardId: card.card_set_id,
    cardName: card.card_name,
    cardType: card.card_type,
    subtypes: splitSubTypes(card.sub_types),
    collectorNumber: card.card_set_id,
    rarityName: card.rarity ?? undefined,
    imageUrls: card.card_image ? [card.card_image] : undefined,
    attributes,
  };
}

/**
 * Catalog adapter for One Piece backed by optcgapi.com. See
 * packages/db/src/sync-catalog.ts for the CLI that drives this to populate
 * Set/Card/Printing/PrintVariant.
 */
export class OptcgAdapter implements CatalogSourceAdapter {
  readonly slug = "optcgapi-one-piece";
  readonly game = "one-piece";
  readonly languageCode = "en";
  private readonly fetchImpl: typeof fetch;
  private setsCache: Promise<OptcgSet[]> | null = null;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`OPTCG API request failed: ${url} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private allSets(): Promise<OptcgSet[]> {
    if (!this.setsCache) {
      this.setsCache = this.fetchJson<OptcgSet[]>(`${OPTCG_BASE}/allSets/`);
    }
    return this.setsCache;
  }

  async listSets(): Promise<SourceSet[]> {
    return (await this.allSets()).map(mapOptcgSet);
  }

  async getSet(setCode: string): Promise<SourceSet | null> {
    const entry = (await this.allSets()).find((s) => s.set_id === setCode);
    return entry ? mapOptcgSet(entry) : null;
  }

  async listSetSummaries(): Promise<SourceSetSummary[]> {
    const sets = await this.allSets();
    if (sets.length === 0) throw new Error("OPTCG API returned an empty set list");
    return sets.map(mapOptcgSetSummary);
  }

  async listPrintings(setCode: string): Promise<SourcePrinting[]> {
    const entry = (await this.allSets()).find((s) => s.set_id === setCode);
    if (!entry) return [];
    const cards = await this.fetchJson<OptcgCard[]>(
      `${OPTCG_BASE}/sets/${encodeURIComponent(setCode)}/`,
    );
    return cards.map(mapOptcgCardToSourcePrinting);
  }
}
