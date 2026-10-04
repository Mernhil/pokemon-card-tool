import { lowestAverage } from "./listing-stats";
export { lowestAverage } from "./listing-stats";
import {
  MIN_TRUSTED_MATCH,
  TCGDEX_LANGUAGES,
  normalizeListingLanguage,
  type MappingStatus,
} from "@tcg-vault/shared";
import { HttpError, NotConfiguredError, createThrottle, requestJson } from "./http";
import {
  nameSimilarity,
  normalizeName,
  scoreCardMatch,
  scoreSetMatch,
  type MatchScore,
} from "./matching";
import {
  tcgdexCardId,
  tcgdexLanguageOf,
  tcgdexMarketIdsFor,
  type TcgdexMarketIds,
  type TcgdexPriceClient,
} from "./tcgdex-prices";
import type {
  PriceProvider,
  PricedCard,
  ProviderCapabilities,
  ProviderObservation,
  ResolvedMapping,
} from "./types";

/**
 * CardTrader marketplace (https://www.cardtrader.com/en/docs/api), with the
 * user's own API token (Settings). Listings only: CardTrader's API has no
 * sold-price history, so everything here is `lowest_listing`, per condition.
 *
 * Card -> blueprint, surest first:
 *   1. the CardTrader blueprint id TCGdex links to the card (newer sets);
 *   2. the blueprint that lists the card's Cardmarket / TCGplayer product id
 *      (TCGdex links one or both for most of the catalog), first in the
 *      expansions named like our set, then in every Pokémon expansion;
 *   3. our collector number (+ name) in the expansion named like our set.
 * Set names alone mislead: CardTrader files the Japanese release of a set
 * as "<name> | <code>" and the Poké Ball / Master Ball reverse holos as
 * their own "<name> - … Reverse Holo" expansions, all sharing the set's
 * collector numbers. Those are only used for cards they are meant for.
 *
 * Field names below follow CardTrader's docs and public examples; they were
 * not verified against the live API from this environment — parsers are
 * deliberately tolerant and fixture-tested (see cardtrader.test.ts).
 */

export interface CardTraderGame {
  id: number;
  name: string;
  display_name?: string;
}
export interface CardTraderExpansion {
  id: number;
  game_id: number;
  code?: string | null;
  name: string;
}
export interface CardTraderBlueprint {
  id: number;
  name: string;
  expansion_id: number;
  category_id?: number | null;
  version?: string | null;
  fixed_properties?: Record<string, unknown> | null;
  card_market_ids?: number[] | null;
  tcg_player_id?: number | null;
}
export interface CardTraderProduct {
  id: number;
  blueprint_id: number;
  name_en?: string;
  quantity?: number;
  price?: { cents?: number; currency?: string } | null;
  price_cents?: number;
  price_currency?: string;
  graded?: boolean | null;
  properties_hash?: Record<string, unknown> | null;
}

/** CardTrader's condition names -> ours. */
export const CARDTRADER_CONDITIONS: Record<string, string> = {
  mint: "MINT",
  "near mint": "NEAR_MINT",
  "slightly played": "LIGHTLY_PLAYED",
  "moderately played": "MODERATELY_PLAYED",
  played: "HEAVILY_PLAYED",
  "heavily played": "HEAVILY_PLAYED",
  poor: "DAMAGED",
};

/** Some endpoints answer a bare array, some wrap it; accept both. */
function list<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    for (const key of ["array", "data", "items"]) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

/** The collector number a blueprint carries, wherever CardTrader put it. */
export function blueprintNumber(bp: CardTraderBlueprint): string | null {
  const props = bp.fixed_properties ?? {};
  for (const [key, value] of Object.entries(props)) {
    if (
      /collector_number|number/.test(key) &&
      (typeof value === "string" || typeof value === "number")
    ) {
      return String(value);
    }
  }
  return null;
}

function propertyMatching(props: Record<string, unknown>, pattern: RegExp): unknown {
  for (const [key, value] of Object.entries(props)) if (pattern.test(key)) return value;
  return undefined;
}

/**
 * Pure: listings -> observations for one variant. Drops graded copies and
 * the wrong finish (reverse holo vs not), then reports the cheapest listing
 * per language, condition and currency with how many listings it was chosen
 * from. One fetch therefore yields a separate observation set for every
 * listing language, so a cheap German copy never mixes into the English
 * number; a listing that names no language is stored with languageCode null.
 */
export function cardTraderObservations(
  products: CardTraderProduct[],
  card: Pick<PricedCard, "finish">,
  { now = new Date(), payloadHash = null }: { now?: Date; payloadHash?: string | null } = {},
): ProviderObservation[] {
  const wantReverse = card.finish === "REVERSE_HOLO";
  const anyReverseInfo = products.some(
    (p) => propertyMatching(p.properties_hash ?? {}, /reverse/) !== undefined,
  );
  // CardTrader didn't say which listings are reverse holo: we can't tell them apart.
  if (wantReverse && !anyReverseInfo) return [];

  const groups = new Map<
    string,
    { condition: string | null; currency: string; language: string | null; prices: number[] }
  >();
  for (const p of products) {
    if (p.graded) continue;
    if ((p.quantity ?? 1) < 1) continue;
    const props = p.properties_hash ?? {};
    const rawLanguage = propertyMatching(props, /language$/);
    const language = normalizeListingLanguage(rawLanguage);
    // A language we don't recognise is neither English nor anything we could label: skip it
    // rather than let it pose as "unsplit".
    if (typeof rawLanguage === "string" && rawLanguage.trim() && !language) continue;
    const reverse = propertyMatching(props, /reverse/);
    if (Boolean(reverse) !== wantReverse) continue;

    const cents = p.price?.cents ?? p.price_cents;
    const currency = (p.price?.currency ?? p.price_currency ?? "").toUpperCase();
    if (typeof cents !== "number" || cents <= 0 || !currency) continue;
    const rawCondition = propertyMatching(props, /^condition$/);
    const condition =
      typeof rawCondition === "string"
        ? (CARDTRADER_CONDITIONS[rawCondition.toLowerCase()] ?? null)
        : null;

    const key = `${language}|${condition}|${currency}`;
    const group = groups.get(key) ?? { condition, currency, language, prices: [] };
    group.prices.push(cents);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((g) => {
    const sorted = [...g.prices].sort((a, b) => a - b);
    const base = {
      currency: g.currency,
      condition: g.condition,
      languageCode: g.language,
      listingCount: sorted.length,
      observedAt: now,
      payloadHash,
    };
    const low = { kind: "lowest_listing" as const, amount: sorted[0]!, ...base };
    // The top of the "cheapest few" range: the 5th cheapest (or the dearest there is, from 2 up).
    const top = sorted[Math.min(4, sorted.length - 1)]!;
    const avg = lowestAverage(sorted);
    return [
      low,
      ...(sorted.length >= 2 && top > sorted[0]!
        ? [{ kind: "lowest_5th" as const, amount: top, ...base }]
        : []),
      ...(avg
        ? [{ kind: "lowest_avg" as const, amount: avg.amount, ...base, listingCount: avg.count }]
        : []),
    ];
  });
}

/**
 * Pure: picks the blueprint for our card among an expansion's blueprints.
 * `setScore` is how sure we are about the expansion itself.
 */
export function matchBlueprint(
  card: Pick<PricedCard, "cardName" | "cardNameAlt" | "collectorNumber" | "externalIds">,
  blueprints: CardTraderBlueprint[],
  setScore: number,
  ids: TcgdexMarketIds = catalogIdsOf(card),
): { blueprint: CardTraderBlueprint | null; confidence: number; notes: string } {
  const exact = findByMarketIds(blueprints, ids);
  if (exact) return { blueprint: exact.blueprint, confidence: 1, notes: exact.notes };

  // A card from another language's catalog carries its own name ("Dracaufeu"); CardTrader's
  // blueprints are named in English.
  const names = [card.cardName, card.cardNameAlt].filter((n): n is string => Boolean(n));
  const scored = blueprints
    .map((bp) => {
      const scores = names.map((name) =>
        scoreCardMatch(
          { name, number: card.collectorNumber },
          { name: bp.name, number: blueprintNumber(bp) },
        ),
      );
      return { bp, ...scores.reduce((a, b) => (b.score > a.score ? b : a)) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best)
    return {
      blueprint: null,
      confidence: 0,
      notes: "No card with this number in the matching expansion",
    };

  let confidence = best.score * setScore;
  let notes = `Matched by ${best.reason}`;
  const tied = scored.filter((s) => s.score === best.score);
  if (tied.length > 1) {
    confidence *= 0.6;
    notes += ` — ${tied.length} candidates (${tied.map((t) => t.bp.version || t.bp.name).join(", ")}), picked the first`;
  }
  return { blueprint: best.bp, confidence: Math.round(confidence * 100) / 100, notes };
}

/** The Cardmarket / TCGplayer ids our catalog already has for a card (see PricedCard.externalIds). */
function catalogIdsOf(card: Pick<PricedCard, "externalIds">): TcgdexMarketIds {
  const num = (v: string | undefined) => (v && Number(v) > 0 ? Number(v) : undefined);
  const cardmarket = num(card.externalIds.cardmarket);
  const tcgplayer = num(card.externalIds.tcgplayer);
  return { ...(cardmarket ? { cardmarket } : {}), ...(tcgplayer ? { tcgplayer } : {}) };
}

/** The blueprint that lists the same Cardmarket (or TCGplayer) product, if any. */
export function findByMarketIds(
  blueprints: CardTraderBlueprint[],
  ids: TcgdexMarketIds,
): { blueprint: CardTraderBlueprint; notes: string } | null {
  if (ids.cardmarket) {
    const hit = blueprints.find((bp) => bp.card_market_ids?.some((id) => Number(id) === ids.cardmarket));
    if (hit) return { blueprint: hit, notes: "Same Cardmarket product id" };
  }
  if (ids.tcgplayer) {
    const hit = blueprints.find((bp) => bp.tcg_player_id != null && Number(bp.tcg_player_id) === ids.tcgplayer);
    if (hit) return { blueprint: hit, notes: "Same TCGplayer product id" };
  }
  return null;
}

/** "Black Bolt | sv11B": CardTrader's Japanese release of a set. Returns its name and code parts. */
export function japaneseExpansion(e: Pick<CardTraderExpansion, "name">): { name: string; code: string } | null {
  const m = e.name.match(/^(.*?)\s*\|\s*([^|]+?)\s*$/);
  return m ? { name: m[1]!, code: m[2]! } : null;
}

/** "Black Bolt - Poké Ball Reverse Holo": a patterned reverse holo filed as its own expansion. */
export function isPatternExpansion(e: Pick<CardTraderExpansion, "name">): boolean {
  return /\breverse holo\b/i.test(e.name);
}

/** Our set code without its language-catalog prefix: "ja-SV11B" -> "SV11B", "it-swsh10tg" -> "swsh10tg". */
export function bareSetCode(code: string): string {
  const prefix = TCGDEX_LANGUAGES.find((l) => code.startsWith(l.prefix))?.prefix;
  if (prefix) return code.slice(prefix.length);
  return code.replace(/^(JP|EN)-/, "");
}

/**
 * How well one CardTrader expansion fits our card's set, 0..1, by its name (ours, or the
 * English catalog's for a card from another language) or code. A Japanese card belongs in
 * CardTrader's Japanese expansions ("<name> | <code>"), anything else never does; the
 * patterned reverse holo expansions are left out (our reverse holo is the ordinary one,
 * which CardTrader lists on the main blueprint).
 */
export function scoreExpansion(
  card: Pick<PricedCard, "setCode" | "setName" | "setNameAlt" | "languageCode">,
  e: CardTraderExpansion,
): MatchScore {
  if (isPatternExpansion(e)) return { score: 0, reason: "patterned reverse holo expansion" };
  const code = bareSetCode(card.setCode);
  const names = [card.setName, card.setNameAlt].filter((n): n is string => Boolean(n));
  const japanese = japaneseExpansion(e);
  const wantJapanese = card.languageCode === "ja";
  if (japanese && !wantJapanese) return { score: 0, reason: "Japanese expansion" };

  const theirs = japanese ? { code: e.code, name: japanese.name } : e;
  let best: MatchScore = { score: 0, reason: "set differs" };
  if (japanese && japanese.code.toLowerCase() === code.toLowerCase())
    best = { score: 0.95, reason: "set code" };
  for (const name of names) {
    const s = scoreSetMatch({ code, name }, theirs);
    if (s.score > best.score) best = s;
  }
  // A Japanese card in an English-language expansion: only when there's nothing better.
  if (wantJapanese && !japanese && best.score > 0)
    return { score: Math.round(best.score * 0.5 * 100) / 100, reason: `${best.reason}, English release` };
  return best;
}

function slimBlueprint(bp: CardTraderBlueprint, expansionId: number): CardTraderBlueprint {
  const number = blueprintNumber(bp);
  return {
    id: bp.id,
    name: bp.name,
    expansion_id: bp.expansion_id ?? expansionId,
    version: bp.version ?? null,
    fixed_properties: number ? { collector_number: number } : {},
    card_market_ids: bp.card_market_ids ?? null,
    tcg_player_id: bp.tcg_player_id ?? null,
  };
}

export function statusFor(confidence: number): MappingStatus {
  return confidence >= MIN_TRUSTED_MATCH
    ? "matched"
    : confidence >= 0.4
      ? "low_confidence"
      : "not_found";
}

export class CardTraderProvider implements PriceProvider {
  readonly id = "cardtrader" as const;
  readonly label = "CardTrader";
  readonly capabilities: ProviderCapabilities = {
    supportsSold: false,
    supportsHistory: false,
    kinds: ["lowest_listing"],
    rateLimit: {
      requests: 10,
      perMs: 1_000,
      note: "marketplace/products: 10 req/s; other endpoints 200 req/10 s (we stay at ~4 req/s)",
    },
    needsCredentials: true,
    games: ["pokemon"],
  };

  private readonly base: string;
  private readonly throttle = createThrottle(250);
  private readonly cacheMs: number;
  private cacheBorn = Date.now();
  private gamesCache: Promise<CardTraderGame[]> | null = null;
  private expansionsCache: Promise<CardTraderExpansion[]> | null = null;
  private readonly blueprintCache = new Map<number, Promise<CardTraderBlueprint[]>>();
  /** Every blueprint loaded so far, by the Cardmarket / TCGplayer product it lists. */
  private readonly byCardmarket = new Map<number, CardTraderBlueprint>();
  private readonly byTcgplayer = new Map<number, CardTraderBlueprint>();
  /** Set once every Pokémon expansion's blueprints are loaded (and indexed). */
  private indexedAll = false;

  constructor(
    private readonly options: {
      token: string | null | undefined;
      fetch?: typeof fetch;
      baseUrl?: string;
      /** Where the card's CardTrader / Cardmarket / TCGplayer ids come from (TCGdex). */
      tcgdex?: TcgdexPriceClient | null;
      /** How long expansions and blueprints are kept before they're fetched again. */
      cacheMs?: number;
    },
  ) {
    this.base = options.baseUrl ?? "https://api.cardtrader.com/api/v2";
    this.cacheMs = options.cacheMs ?? 12 * 3_600_000;
  }

  isConfigured(): boolean {
    return Boolean(this.options.token);
  }

  private get<T>(path: string) {
    if (!this.options.token) throw new NotConfiguredError(this.id);
    return requestJson<T>(
      `${this.base}${path}`,
      { headers: { Authorization: `Bearer ${this.options.token}`, Accept: "application/json" } },
      { provider: this.id, fetch: this.options.fetch, throttle: this.throttle },
    );
  }

  /** New sets appear on CardTrader all the time: drop what we know after `cacheMs`. */
  private expireCaches(): void {
    if (Date.now() - this.cacheBorn < this.cacheMs) return;
    this.cacheBorn = Date.now();
    this.gamesCache = null;
    this.expansionsCache = null;
    this.blueprintCache.clear();
    this.byCardmarket.clear();
    this.byTcgplayer.clear();
    this.indexedAll = false;
  }

  private games(): Promise<CardTraderGame[]> {
    this.gamesCache ??= this.get<unknown>("/games").then(({ data }) => list<CardTraderGame>(data));
    this.gamesCache.catch(() => (this.gamesCache = null));
    return this.gamesCache;
  }

  private expansions(): Promise<CardTraderExpansion[]> {
    this.expansionsCache ??= this.get<unknown>("/expansions").then(({ data }) =>
      list<CardTraderExpansion>(data),
    );
    this.expansionsCache.catch(() => (this.expansionsCache = null));
    return this.expansionsCache;
  }

  private blueprints(expansionId: number): Promise<CardTraderBlueprint[]> {
    let value = this.blueprintCache.get(expansionId);
    if (!value) {
      value = this.get<unknown>(`/blueprints/export?expansion_id=${expansionId}`).then(({ data }) => {
        // Only what matching needs: the full export (properties, images) of every Pokémon
        // expansion would hold hundreds of MB.
        const slim = list<CardTraderBlueprint>(data).map((bp) => slimBlueprint(bp, expansionId));
        for (const bp of slim) {
          for (const id of bp.card_market_ids ?? []) this.byCardmarket.set(Number(id), bp);
          if (bp.tcg_player_id != null) this.byTcgplayer.set(Number(bp.tcg_player_id), bp);
        }
        return slim;
      });
      value.catch(() => this.blueprintCache.delete(expansionId));
      this.blueprintCache.set(expansionId, value);
    }
    return value;
  }

  private indexed(ids: TcgdexMarketIds): { blueprint: CardTraderBlueprint; notes: string } | null {
    const cm = ids.cardmarket ? this.byCardmarket.get(ids.cardmarket) : undefined;
    if (cm) return { blueprint: cm, notes: "Same Cardmarket product id" };
    const tp = ids.tcgplayer ? this.byTcgplayer.get(ids.tcgplayer) : undefined;
    if (tp) return { blueprint: tp, notes: "Same TCGplayer product id" };
    return null;
  }

  /**
   * The blueprint listing one of the card's marketplace ids, in any Pokémon expansion.
   * Expansions are loaded most-likely first and stay cached, so after a first full pass
   * (a few minutes, once per `cacheMs`) this is a lookup.
   */
  private async findAnywhere(
    ids: TcgdexMarketIds,
    expansions: CardTraderExpansion[],
    names: string[],
  ): Promise<{ blueprint: CardTraderBlueprint; notes: string } | null> {
    const known = this.indexed(ids);
    if (known || this.indexedAll) return known;
    const likely = (e: CardTraderExpansion) =>
      Math.max(0, ...names.map((n) => nameSimilarity(n, japaneseExpansion(e)?.name ?? e.name)));
    const order = expansions
      .filter((e) => !this.blueprintCache.has(e.id))
      .map((e) => ({ e, sim: likely(e) }))
      .sort((a, b) => b.sim - a.sim || b.e.id - a.e.id);
    for (const { e } of order) {
      try {
        await this.blueprints(e.id);
      } catch (err) {
        // One expansion CardTrader won't export doesn't end the search; a rate limit or a
        // bad token does (the item is retried, and what's loaded stays cached).
        if (err instanceof HttpError && err.status === 404) continue;
        throw err;
      }
      const hit = this.indexed(ids);
      if (hit) return hit;
    }
    this.indexedAll = true;
    return null;
  }

  /**
   * The ids TCGdex links to this card and finish (CardTrader blueprint, Cardmarket and
   * TCGplayer products), with the catalog's own Cardmarket / TCGplayer links as fallback.
   * TCGdex being unreachable only loses the shortcut.
   */
  private async catalogIds(card: PricedCard): Promise<TcgdexMarketIds> {
    const own = catalogIdsOf(card);
    const id = this.options.tcgdex ? tcgdexCardId(card) : null;
    if (!id || !this.options.tcgdex) return own;
    try {
      const linked = tcgdexMarketIdsFor(
        await this.options.tcgdex.card(id, tcgdexLanguageOf(card)),
        card.finish,
      );
      return { ...own, ...linked };
    } catch {
      return own;
    }
  }

  async resolveMapping(card: PricedCard): Promise<ResolvedMapping | null> {
    if (!this.isConfigured()) return null;
    this.expireCaches();
    const notFound = (notes: string): ResolvedMapping => ({
      externalId: null,
      query: null,
      url: null,
      confidence: 0,
      status: "not_found",
      notes,
    });
    const matched = (blueprint: number, confidence: number, notes: string): ResolvedMapping => ({
      externalId: String(blueprint),
      query: null,
      url: `https://www.cardtrader.com/cards/${blueprint}`,
      confidence,
      status: statusFor(confidence),
      notes,
    });

    const ids = await this.catalogIds(card);
    // 1. TCGdex knows the CardTrader blueprint itself.
    if (ids.cardtrader) return matched(ids.cardtrader, 1, "CardTrader blueprint linked by TCGdex");

    const games = await this.games();
    const game = games.find((g) =>
      normalizeName(`${g.name} ${g.display_name ?? ""}`).includes("pokemon"),
    );
    if (!game) return notFound("CardTrader has no Pokémon game");

    const expansions = (await this.expansions()).filter((e) => e.game_id === game.id);
    const byId = new Map(expansions.map((e) => [e.id, e]));
    const candidates = expansions
      .map((e) => ({ e, ...scoreExpansion(card, e) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    // 2. The blueprint that lists the card's Cardmarket / TCGplayer product: in the expansions
    //    named like our set first, then anywhere.
    if (ids.cardmarket || ids.tcgplayer) {
      for (const c of candidates) {
        const exact = findByMarketIds(await this.blueprints(c.e.id), ids);
        if (exact) return matched(exact.blueprint.id, 1, `${exact.notes}, in "${c.e.name}"`);
      }
      const names = [card.setNameAlt, card.setName].filter((n): n is string => Boolean(n));
      const anywhere = await this.findAnywhere(ids, expansions, names);
      if (anywhere) {
        const where = byId.get(anywhere.blueprint.expansion_id)?.name;
        return matched(anywhere.blueprint.id, 1, `${anywhere.notes}${where ? `, in "${where}"` : ""}`);
      }
    }

    if (candidates.length === 0) {
      const ourNames = [card.setNameAlt, card.setName].filter((n): n is string => Boolean(n));
      const hint = expansions
        .filter((e) => !isPatternExpansion(e))
        .map((e) => ({ name: e.name, sim: Math.max(...ourNames.map((n) => nameSimilarity(n, e.name))) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
        .map((c) => `"${c.name}"`)
        .join(", ");
      const shown = card.setNameAlt ? `${card.setName}" / "${card.setNameAlt}` : card.setName;
      return notFound(
        `No CardTrader expansion matches "${shown}" (${card.setCode})${hint ? ` — closest: ${hint}` : ""}`,
      );
    }

    // 3. Collector number (+ name) in the best expansion; one that has no card with our number
    //    (the gallery cards live in another expansion) doesn't end the search.
    let set = candidates[0]!;
    let match = matchBlueprint(card, await this.blueprints(set.e.id), set.score, ids);
    for (const candidate of candidates.slice(1)) {
      if (match.blueprint) break;
      const next = matchBlueprint(card, await this.blueprints(candidate.e.id), candidate.score, ids);
      if (next.blueprint) {
        set = candidate;
        match = next;
      }
    }
    if (!match.blueprint) {
      return notFound(
        `${match.notes} (looked in ${candidates.map((c) => `"${c.e.name}"`).join(", ")})`,
      );
    }
    return matched(
      match.blueprint.id,
      match.confidence,
      `${match.notes}; expansion "${set.e.name}" by ${set.reason}`,
    );
  }

  async fetchPrices(card: PricedCard, mapping: ResolvedMapping): Promise<ProviderObservation[]> {
    if (!mapping.externalId) return [];
    const { data, hash } = await this.get<unknown>(
      `/marketplace/products?blueprint_id=${encodeURIComponent(mapping.externalId)}`,
    );
    // Documented shape: { "<blueprint_id>": [products] }.
    const products =
      data && typeof data === "object" && !Array.isArray(data) && mapping.externalId in data
        ? list<CardTraderProduct>((data as Record<string, unknown>)[mapping.externalId])
        : list<CardTraderProduct>(data);
    return cardTraderObservations(products, card, { payloadHash: hash });
  }

  async testConnection() {
    if (!this.isConfigured()) return { ok: false, message: "API token not set" };
    try {
      const { data } = await this.get<{ name?: string; shared_secret?: string }>("/info");
      return { ok: true, message: `Connected${data?.name ? ` as "${data.name}"` : ""}.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
