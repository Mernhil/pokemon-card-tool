import { MIN_TRUSTED_MATCH, type MappingStatus } from "@tcg-vault/shared";
import { NotConfiguredError, createThrottle, requestJson } from "./http";
import { normalizeName, scoreCardMatch, scoreSetMatch } from "./matching";
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
 * Pure: listings -> observations for one variant. Drops graded copies, other
 * languages, and the wrong finish (reverse holo vs not), then reports the
 * cheapest listing per condition (and currency) with how many listings it
 * was chosen from.
 */
export function cardTraderObservations(
  products: CardTraderProduct[],
  card: Pick<PricedCard, "finish" | "languageCode">,
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
    { condition: string | null; currency: string; prices: number[] }
  >();
  for (const p of products) {
    if (p.graded) continue;
    if ((p.quantity ?? 1) < 1) continue;
    const props = p.properties_hash ?? {};
    const language = propertyMatching(props, /language$/);
    if (typeof language === "string" && language.toLowerCase() !== card.languageCode.toLowerCase())
      continue;
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

    const key = `${condition}|${currency}`;
    const group = groups.get(key) ?? { condition, currency, prices: [] };
    group.prices.push(cents);
    groups.set(key, group);
  }

  return [...groups.values()].map((g) => ({
    kind: "lowest_listing" as const,
    amount: Math.min(...g.prices),
    currency: g.currency,
    condition: g.condition,
    listingCount: g.prices.length,
    observedAt: now,
    payloadHash,
  }));
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
    const set = expansions
      .map((e) => ({ e, ...scoreSetMatch({ code: card.setCode, name: card.setName }, e) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (!set) return notFound(`No CardTrader expansion matches "${card.setName}"`);

    const match = matchBlueprint(card, await this.blueprints(set.e.id), set.score);
    if (!match.blueprint) return notFound(match.notes);
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
