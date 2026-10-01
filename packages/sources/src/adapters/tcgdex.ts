import TCGdex from "@tcgdex/sdk";
import { TCGDEX_LANGUAGES } from "@tcg-vault/shared";
import type {
  CatalogSourceAdapter,
  SourcePriceQuote,
  SourcePrinting,
  SourceSet,
  SourceSetSummary,
} from "../types";

/**
 * The SDK maps every non-200 response (a proxy's 403, a 429 rate limit, a
 * captive portal) to "not found", which made a blocked connection look like
 * "that set doesn't exist". Only a real 404 means not-found here; anything
 * else throws so callers can say "couldn't reach TCGdex". `globalThis.fetch`
 * is looked up per call so tests can stub it.
 */
export async function strictTcgdexFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const res = await globalThis.fetch(input, init);
  if (res.status !== 200 && res.status !== 404) {
    throw new Error(`TCGdex request failed: ${String(input)} -> HTTP ${res.status}`);
  }
  return res;
}
TCGdex.fetch = strictTcgdexFetch as typeof fetch;

/**
 * Default number of card detail requests in flight at once, per set. The
 * background sync runs 2 sets at a time, so this is kept low: TCGdex is a
 * free community API, and we'd rather be slow than rate-limited.
 */
const DEFAULT_CONCURRENCY = 4;

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
  variants?: TcgdexVariants;
}

/** TCGdex's per-set default / per-card override flags for which finishes exist. */
export interface TcgdexVariants {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
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
  /** Only present when the card overrides its set's default `variants`. */
  variants?: TcgdexVariants;
  /** Not in the SDK's typings yet, but served by the API on every card. */
  pricing?: TcgdexPricing;
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

/** Cardmarket's price guide row as TCGdex relays it: EUR, major units. */
export interface TcgdexCardmarketPrice {
  updated?: string;
  unit?: string;
  /** Cardmarket's own product id for this printing. */
  idProduct?: number | string | null;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  "avg-holo"?: number | null;
  "low-holo"?: number | null;
  "trend-holo"?: number | null;
}

/** One TCGplayer sub-type ("Normal", "Holofoil", "Reverse Holofoil"): USD, major units. */
export interface TcgdexTcgplayerRow {
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
}

export interface TcgdexPricing {
  cardmarket?: TcgdexCardmarketPrice | null;
  tcgplayer?:
    | ({ updated?: string; unit?: string; productId?: number | string | null } & Record<
        string,
        TcgdexTcgplayerRow | string | number | null | undefined
      >)
    | null;
}

/** Major units (1.23) -> minor units (123); drops missing/zero/garbage. */
function toMinor(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

function hasAmount(quote: SourcePriceQuote): boolean {
  return [quote.low, quote.mid, quote.market, quote.trend].some((v) => v !== undefined);
}

/**
 * Pure: TCGdex `pricing` -> one quote per (finish, source).
 *
 * TCGplayer splits by sub-type, which maps 1:1 onto our finishes. Cardmarket
 * has one product per printing with a base price plus "-holo" columns for
 * the foil version; for a card that exists non-foil that's the reverse holo,
 * and for a holo-only card the base price already *is* the holo, so the base
 * goes to the card's primary finish (NON_FOIL if it has one, else HOLO) and
 * "-holo" to REVERSE_HOLO. Quotes for finishes the card isn't printed in are
 * dropped.
 */
export function pricesFor(
  pricing: TcgdexPricing | undefined,
  finishes: string[],
): SourcePriceQuote[] {
  if (!pricing) return [];
  const known = finishes.length > 0 ? finishes : ["NON_FOIL"];
  const quotes: SourcePriceQuote[] = [];

  const cm = pricing.cardmarket;
  if (cm) {
    const primary = known.includes("NON_FOIL")
      ? "NON_FOIL"
      : known.includes("HOLO")
        ? "HOLO"
        : known[0]!;
    const externalId = cm.idProduct != null ? String(cm.idProduct) : undefined;
    quotes.push({
      finish: primary,
      source: "CARDMARKET",
      currency: "EUR",
      low: toMinor(cm.low),
      mid: toMinor(cm.avg),
      trend: toMinor(cm.trend),
      observedAt: cm.updated,
      externalId,
    });
    if (known.includes("REVERSE_HOLO") && primary !== "REVERSE_HOLO") {
      quotes.push({
        finish: "REVERSE_HOLO",
        source: "CARDMARKET",
        currency: "EUR",
        low: toMinor(cm["low-holo"]),
        mid: toMinor(cm["avg-holo"]),
        trend: toMinor(cm["trend-holo"]),
        observedAt: cm.updated,
        externalId,
      });
    }
  }

  const tp = pricing.tcgplayer;
  if (tp) {
    const subTypes: Record<string, string> = {
      normal: "NON_FOIL",
      holofoil: "HOLO",
      holo: "HOLO",
      "reverse-holofoil": "REVERSE_HOLO",
      reverse: "REVERSE_HOLO",
    };
    const seen = new Set<string>();
    for (const [key, finish] of Object.entries(subTypes)) {
      const row = tp[key];
      if (!row || typeof row !== "object" || seen.has(finish)) continue;
      seen.add(finish);
      quotes.push({
        finish,
        source: "TCGPLAYER",
        currency: "USD",
        low: toMinor(row.lowPrice),
        mid: toMinor(row.midPrice),
        market: toMinor(row.marketPrice),
        observedAt: tp.updated,
        externalId: tp.productId != null ? String(tp.productId) : undefined,
      });
    }
  }

  return quotes.filter((q) => known.includes(q.finish) && hasAmount(q));
}

/**
 * Pure: which of our Finish values a card exists in. TCGdex only puts
 * `variants` on a card when it overrides the set's defaults, so an ordinary
 * card with no `variants` of its own inherits the set's. Card flags win
 * field-by-field over the set's. (`firstEdition` is an edition, not a finish,
 * and is ignored here.) Returns [] when neither says anything.
 */
export function finishesFor(
  cardVariants: TcgdexVariants | undefined,
  setVariants: TcgdexVariants | undefined,
): string[] {
  const merged = { ...setVariants, ...cardVariants };
  const finishes: string[] = [];
  if (merged.normal) finishes.push("NON_FOIL");
  if (merged.holo) finishes.push("HOLO");
  if (merged.reverse) finishes.push("REVERSE_HOLO");
  return finishes;
}

function collectorNumberFor(card: TcgdexCardInput): string {
  const official = card.set?.cardCount?.official;
  return official ? `${card.localId}/${official}` : card.localId;
}

/** Pure, network-free: TCGdex Card -> our SourcePrinting. */
export function mapTcgdexCardToSourcePrinting(
  card: TcgdexCardInput,
  setVariants?: TcgdexVariants,
): SourcePrinting {
  const finishes = finishesFor(card.variants, setVariants);
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
    // TCGdex's own getImageURL(quality, ext) builds the same strings; done
    // inline here so the mapping stays a pure function of its input. Not every
    // quality/format exists for every card (brand-new sets especially), so
    // the sync tries these in order.
    imageUrls: card.image
      ? [
          `${card.image}/high.webp`,
          `${card.image}/high.png`,
          `${card.image}/low.webp`,
          `${card.image}/low.png`,
        ]
      : undefined,
    attributes,
    finishes,
    prices: pricesFor(card.pricing, finishes),
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
  readonly slug: string;
  readonly game = "pokemon";
  readonly languageCode: string;
  private readonly client: TCGdex;
  private readonly concurrency: number;
  private readonly codePrefix: string;

  /**
   * `language` is a TCGdex language ("en", "ja", ...). Non-English catalogs get
   * their own source slug and a `codePrefix` on every set code (TCGdex reuses
   * ids like "neo1" across languages, and our set codes are unique per game).
   */
  constructor(
    client?: TCGdex,
    options: { concurrency?: number; language?: string; codePrefix?: string } = {},
  ) {
    const tcgdexLanguage = options.language ?? "en";
    this.languageCode =
      TCGDEX_LANGUAGES.find((l) => l.tcgdex === tcgdexLanguage)?.code ?? tcgdexLanguage;
    this.client = client ?? new TCGdex(tcgdexLanguage as ConstructorParameters<typeof TCGdex>[0]);
    this.slug = tcgdexLanguage === "en" ? "tcgdex-pokemon" : `tcgdex-pokemon-${tcgdexLanguage}`;
    this.codePrefix = options.codePrefix ?? "";
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  }

  private tagSet(set: SourceSet): SourceSet {
    return {
      ...set,
      code: this.codePrefix + set.code,
      ...(this.languageCode !== "en" ? { languageCode: this.languageCode } : {}),
    };
  }

  private bare(code: string): string {
    return code.startsWith(this.codePrefix) ? code.slice(this.codePrefix.length) : code;
  }

  async listSets(): Promise<SourceSet[]> {
    const resumes = await this.client.set.list();
    const results: SourceSet[] = [];

    for (const batch of chunk(resumes, this.concurrency)) {
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
        if (set) results.push(this.tagSet(mapTcgdexSetToSourceSet(set)));
      }
    }

    return results;
  }

  /** One set's details, or null when TCGdex has no set with that id. */
  async getSet(setCode: string): Promise<SourceSet | null> {
    const set = await this.client.set.get(this.bare(setCode));
    return set ? this.tagSet(mapTcgdexSetToSourceSet(set)) : null;
  }

  /**
   * Every set's id/name/card count from a single request (unlike
   * {@link listSets}, which loads each set's details) — newest first, for
   * pickers.
   */
  async listSetSummaries(): Promise<SourceSetSummary[]> {
    const resumes = await this.client.set.list();
    if (resumes.length === 0) throw new Error("TCGdex returned an empty set list");
    return resumes
      .map((r) => ({ code: this.codePrefix + r.id, name: r.name, totalCards: r.cardCount?.total }))
      .reverse();
  }

  async listPrintings(setCode: string): Promise<SourcePrinting[]> {
    const set = await this.client.set.get(this.bare(setCode));
    if (!set) return [];

    const results: SourcePrinting[] = [];

    for (const batch of chunk(set.cards, this.concurrency)) {
      const details = await Promise.all(
        batch.map(async (resume) => {
          // One retry for transient failures, then fail the set loudly rather
          // than silently dropping the card.
          try {
            return await resume.getCard();
          } catch {
            try {
              return await resume.getCard();
            } catch (err) {
              throw new Error(
                `failed to load card "${resume.id}": ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }),
      );
      for (const card of details) {
        if (card) results.push(mapTcgdexCardToSourcePrinting(card, set.variants));
      }
    }

    return results;
  }
}
