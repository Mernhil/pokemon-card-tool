import { MIN_TRUSTED_MATCH, normalizeListingLanguage, type MappingStatus } from "@tcg-vault/shared";
import { NotConfiguredError, createThrottle, requestJson } from "./http";
import { nameSimilarity, normalizeName, scoreCardMatch, scoreSetMatch } from "./matching";
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
 * Card -> blueprint: game "Pokémon" -> the expansion matching our set's name
 * (or code) -> the blueprint with our collector number (+ name). A
 * Cardmarket id that TCGdex gave us, when CardTrader lists it on the
 * blueprint, is an exact match.
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
 * Pure: the "what a copy really costs" number from a sorted list of listing prices — the
 * average of the cheapest few. How many it averages depends on how deep the market is: up to
 * five with plenty of listings, two with only a handful, nothing with fewer than three (the
 * cheapest listing then stands alone).
 *
 * A price gap alone doesn't decide what is real; support does. Listings are grouped into
 * price levels (a new level starts where the price jumps more than 15%), and a level counts
 * as the market only when several listings sit in it (3, or 2 while there are fewer than 8).
 * The average starts at the first such level. So a lone listing far below the rest — or a
 * couple of them — is a random post and is skipped, while a deep, gradually rising market
 * (a card whose better copies run to the 80s) is followed upward as far as the average
 * needs, but never across a jump of more than 25% to a level of its own.
 * null when fewer than two listings qualify.
 */
export function lowestAverage(sorted: number[]): { amount: number; count: number } | null {
  const n = sorted.length;
  if (n < 3) return null;

  const levels: number[][] = [[sorted[0]!]];
  for (let i = 1; i < n; i++) {
    if (sorted[i]! > sorted[i - 1]! * 1.15) levels.push([sorted[i]!]);
    else levels[levels.length - 1]!.push(sorted[i]!);
  }
  const support = n >= 8 ? 3 : 2;
  const real = levels.filter((l) => l.length >= support);
  if (real.length === 0) return null;

  // A small level far below the next real one is a random cheap post, not the floor.
  let start = real[0]!;
  const startIdx = levels.indexOf(start);
  const next = levels.slice(startIdx + 1).find((l) => l.length >= support);
  if (start.length < 3 && next && start[0]! < 0.7 * next[0]!) start = next;

  const want = n >= 20 ? 5 : n >= 12 ? 4 : n >= 6 ? 3 : 2;
  const picked = [...start];
  for (const level of levels.slice(levels.indexOf(start) + 1)) {
    if (picked.length >= want) break;
    if (level.length < support || level[0]! > picked[picked.length - 1]! * 1.25) break;
    picked.push(...level);
  }
  const used = picked.slice(0, want);
  if (used.length < 2) return null;
  return {
    amount: Math.round(used.reduce((x, y) => x + y, 0) / used.length),
    count: used.length,
  };
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
  card: Pick<PricedCard, "cardName" | "collectorNumber" | "externalIds">,
  blueprints: CardTraderBlueprint[],
  setScore: number,
): { blueprint: CardTraderBlueprint | null; confidence: number; notes: string } {
  const cardmarketId = card.externalIds.cardmarket ? Number(card.externalIds.cardmarket) : null;
  if (cardmarketId) {
    const exact = blueprints.find((bp) => bp.card_market_ids?.includes(cardmarketId));
    if (exact) return { blueprint: exact, confidence: 1, notes: "Same Cardmarket product id" };
  }

  const scored = blueprints
    .map((bp) => ({
      bp,
      ...scoreCardMatch(
        { name: card.cardName, number: card.collectorNumber },
        { name: bp.name, number: blueprintNumber(bp) },
      ),
    }))
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
  private gamesCache: Promise<CardTraderGame[]> | null = null;
  private expansionsCache: Promise<CardTraderExpansion[]> | null = null;
  private readonly blueprintCache = new Map<number, Promise<CardTraderBlueprint[]>>();

  constructor(
    private readonly options: {
      token: string | null | undefined;
      fetch?: typeof fetch;
      baseUrl?: string;
    },
  ) {
    this.base = options.baseUrl ?? "https://api.cardtrader.com/api/v2";
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
      value = this.get<unknown>(`/blueprints/export?expansion_id=${expansionId}`).then(({ data }) =>
        list<CardTraderBlueprint>(data),
      );
      value.catch(() => this.blueprintCache.delete(expansionId));
      this.blueprintCache.set(expansionId, value);
    }
    return value;
  }

  async resolveMapping(card: PricedCard): Promise<ResolvedMapping | null> {
    if (!this.isConfigured()) return null;
    const notFound = (notes: string): ResolvedMapping => ({
      externalId: null,
      query: null,
      url: null,
      confidence: 0,
      status: "not_found",
      notes,
    });

    const games = await this.games();
    const game = games.find((g) =>
      normalizeName(`${g.name} ${g.display_name ?? ""}`).includes("pokemon"),
    );
    if (!game) return notFound("CardTrader has no Pokémon game");

    const expansions = (await this.expansions()).filter((e) => e.game_id === game.id);
    const candidates = expansions
      .map((e) => {
        const own = scoreSetMatch({ code: card.setCode, name: card.setName }, e);
        // CardTrader names its expansions in English: a card from an Italian or Japanese
        // catalog is also tried under its English set's name.
        const alt = card.setNameAlt
          ? scoreSetMatch({ code: card.setCode, name: card.setNameAlt }, e)
          : own;
        return { e, ...(alt.score > own.score ? alt : own) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    if (candidates.length === 0) {
      const hint = expansions
        .map((e) => ({ name: e.name, sim: nameSimilarity(card.setName, e.name) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
        .map((c) => `"${c.name}"`)
        .join(", ");
      return notFound(
        `No CardTrader expansion matches "${card.setName}" (${card.setCode})${hint ? ` — closest: ${hint}` : ""}`,
      );
    }

    // Best expansion first, but one that has no card with our number (the gallery cards live in
    // another expansion) doesn't end the search.
    let set = candidates[0]!;
    let match = matchBlueprint(card, await this.blueprints(set.e.id), set.score);
    for (const candidate of candidates.slice(1)) {
      if (match.blueprint) break;
      const next = matchBlueprint(card, await this.blueprints(candidate.e.id), candidate.score);
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
    return {
      externalId: String(match.blueprint.id),
      query: null,
      url: `https://www.cardtrader.com/cards/${match.blueprint.id}`,
      confidence: match.confidence,
      status: statusFor(match.confidence),
      notes: `${match.notes}; expansion by ${set.reason}`,
    };
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
