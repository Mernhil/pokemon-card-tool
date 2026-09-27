import TCGdex from "@tcgdex/sdk";
import type { CatalogSourceAdapter, SourcePrinting, SourceSet } from "../types";

/** How many set/card detail requests to have in flight at once. */
const CONCURRENCY = 10;

/**
 * The subset of TCGdex's `Set` shape our mapping needs. Deliberately not the
 * SDK's own `Set` type: keeping this local means {@link mapTcgdexSetToSourceSet}
 * can be unit-tested with plain object literals instead of real SDK model
 * instances (which carry live methods/circular `sdk` refs).
 */
export interface TcgdexSetInput {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  releaseDate?: string;
  serie?: { name?: string };
  cardCount?: { official?: number; total?: number };
}

/** The subset of TCGdex's `Card` shape our mapping needs — see {@link TcgdexSetInput}. */
export interface TcgdexCardInput {
  id: string;
  localId: string;
  name: string;
  image?: string;
  illustrator?: string;
  rarity?: string;
  category?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  suffix?: string;
  evolveFrom?: string;
  level?: number | string;
  weight?: string;
  description?: string;
  item?: { name: string; effect: string };
  abilities?: Array<{ type: string; name: string; effect: string }>;
  attacks?: Array<{ cost?: string[]; name: string; effect?: string; damage?: string | number }>;
  weaknesses?: Array<{ type: string; value?: string }>;
  resistances?: Array<{ type: string; value?: string }>;
  retreat?: number;
  effect?: string;
  trainerType?: string;
  energyType?: string;
  regulationMark?: string;
  dexId?: number[];
  set?: { cardCount?: { official?: number; total?: number } };
}

/** Pure, network-free: TCGdex Set -> our SourceSet. */
export function mapTcgdexSetToSourceSet(set: TcgdexSetInput): SourceSet {
  return {
    code: set.id,
    name: set.name,
    series: set.serie?.name,
    releaseDate: set.releaseDate,
    printedTotal: set.cardCount?.official,
    totalCards: set.cardCount?.total,
    // TCGdex serves asset URLs without an extension; .png is what the SDK's
    // own SerieResume/SetResume#getImageURL default to for logos/symbols.
    logoUrl: set.logo ? `${set.logo}.png` : undefined,
    symbolUrl: set.symbol ? `${set.symbol}.png` : undefined,
  };
}

function collectorNumberFor(card: TcgdexCardInput): string {
  const official = card.set?.cardCount?.official;
  return official ? `${card.localId}/${official}` : card.localId;
}

/** Pure, network-free: TCGdex Card -> our SourcePrinting. */
export function mapTcgdexCardToSourcePrinting(card: TcgdexCardInput): SourcePrinting {
  const subtypes = [card.stage, card.suffix, card.trainerType, card.energyType].filter(
    (value): value is string => Boolean(value),
  );

  const attributes: Record<string, unknown> = {};
  if (card.hp !== undefined) attributes.hp = card.hp;
  if (card.types) attributes.types = card.types;
  if (card.evolveFrom) attributes.evolveFrom = card.evolveFrom;
  if (card.level !== undefined) attributes.level = card.level;
  if (card.weight) attributes.weight = card.weight;
  if (card.description) attributes.description = card.description;
  if (card.item) attributes.item = card.item;
  if (card.abilities) attributes.abilities = card.abilities;
  if (card.attacks) attributes.attacks = card.attacks;
  if (card.weaknesses) attributes.weaknesses = card.weaknesses;
  if (card.resistances) attributes.resistances = card.resistances;
  if (card.retreat !== undefined) attributes.retreat = card.retreat;
  if (card.effect) attributes.effect = card.effect;
  if (card.regulationMark) attributes.regulationMark = card.regulationMark;
  if (card.dexId) attributes.dexId = card.dexId;

  return {
    externalCardId: card.id,
    cardName: card.name,
    cardType: card.category ?? "Unknown",
    subtypes,
    collectorNumber: collectorNumberFor(card),
    rarityName: card.rarity,
    artistName: card.illustrator,
    // TCGdex's own getImageURL("high", "webp") builds the same string; done
    // inline here so the mapping stays a pure function of its input.
    imageUrl: card.image ? `${card.image}/high.webp` : undefined,
    attributes,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Catalog adapter backed by the official TCGdex SDK, scoped to Pokemon in
 * English only. See packages/db/src/sync-catalog.ts for the CLI that drives
 * this to populate Set/Card/Printing/PrintVariant.
 */
export class TcgdexPokemonAdapter implements CatalogSourceAdapter {
  readonly slug = "tcgdex-pokemon";
  private readonly client: TCGdex;

  constructor(client: TCGdex = new TCGdex("en")) {
    this.client = client;
  }

  async listSets(): Promise<SourceSet[]> {
    const resumes = await this.client.set.list();
    const results: SourceSet[] = [];

    for (const batch of chunk(resumes, CONCURRENCY)) {
      const details = await Promise.all(
        batch.map(async (resume) => {
          try {
            return await this.client.set.get(resume.id);
          } catch (err) {
            console.error(`[tcgdex] failed to load set "${resume.id}":`, err);
            return null;
          }
        }),
      );
      for (const set of details) {
        if (set) results.push(mapTcgdexSetToSourceSet(set));
      }
    }

    return results;
  }

  async listPrintings(setCode: string): Promise<SourcePrinting[]> {
    const set = await this.client.set.get(setCode);
    if (!set) return [];

    const results: SourcePrinting[] = [];

    for (const batch of chunk(set.cards, CONCURRENCY)) {
      const details = await Promise.all(
        batch.map(async (resume) => {
          try {
            return await resume.getCard();
          } catch (err) {
            console.error(`[tcgdex] failed to load card "${resume.id}":`, err);
            return null;
          }
        }),
      );
      for (const card of details) {
        if (card) results.push(mapTcgdexCardToSourcePrinting(card));
      }
    }

    return results;
  }
}
