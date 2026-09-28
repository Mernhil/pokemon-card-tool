import type { FetchedPrice, PriceSourceAdapter, VariantRef } from "../types";

/**
 * CardTrader's public API v2 (https://www.cardtrader.com/docs/api/full/v2).
 * Unlike ebay.ts, this hasn't been checked against a live response — this
 * environment has no network access to api.cardtrader.com to verify field
 * names — so treat the shapes below (`CardTraderBlueprint`,
 * `CardTraderProduct`) as best-effort from the published docs and confirm
 * them against one real response before relying on this in production.
 * Every request is wrapped so a shape mismatch degrades to "no prices for
 * this card" rather than throwing and failing a whole sync.
 *
 * CardTrader has no search-by-name endpoint: matching one of our printings
 * to their "blueprint" id has to go through their per-expansion blueprint
 * export, matched by collector number (bundled inside `blueprint.card_number`
 * in some responses, sometimes embedded in `name` in others). The resolved
 * id is meant to be cached in MarketplaceMapping.productId (packages/db
 * schema) so this expensive lookup only happens once per printing, not
 * every price refresh — that caching isn't wired up yet, see the module's
 * `resolveBlueprint` for where a caller would plug it in.
 */

const BASE_URL = "https://api.cardtrader.com/api/v2";
/** CardTrader's game id for Pokémon (from GET /games) — verify, don't assume stable across accounts. */
const POKEMON_GAME_ID = 5;

interface CardTraderExpansion {
  id: number;
  code: string | null;
  name: string;
}

interface CardTraderBlueprint {
  id: number;
  name: string;
  version: string | null; // e.g. "Reverse Holo", "Holo", null for non-foil
  expansion_id: number;
  card_market_id: number | null;
}

interface CardTraderProduct {
  id: number;
  blueprint_id: number;
  price_cents: number;
  price_currency: string;
  quantity: number;
  properties_hash?: { condition?: string; pokemon_language?: string };
}

function toMinor(cents: number | null | undefined): number | undefined {
  return typeof cents === "number" && Number.isFinite(cents) && cents > 0 ? Math.round(cents) : undefined;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Matches our finish string to CardTrader's free-text `version` field, best-effort. */
export function versionMatches(finish: string, version: string | null): boolean {
  const v = (version ?? "").toLowerCase();
  switch (finish) {
    case "REVERSE_HOLO":
      return v.includes("reverse");
    case "HOLO":
    case "COSMOS_HOLO":
      return v.includes("holo") && !v.includes("reverse");
    case "NON_FOIL":
      return v === "" || v.includes("normal") || v.includes("unlimited");
    default:
      return v.includes(finish.toLowerCase().replace(/_/g, " "));
  }
}

export class CardTraderAdapter implements PriceSourceAdapter {
  readonly slug = "cardtrader";
  private expansionsByName: Map<string, CardTraderExpansion> | null = null;
  private blueprintsByExpansion = new Map<number, CardTraderBlueprint[]>();

  constructor(private readonly apiToken: string) {}

  private async get<T>(path: string, params?: Record<string, string>): Promise<T | null> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiToken}` } });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  }

  private async expansions(): Promise<Map<string, CardTraderExpansion>> {
    if (this.expansionsByName) return this.expansionsByName;
    const list =
      (await this.get<CardTraderExpansion[]>("/expansions", { game_id: String(POKEMON_GAME_ID) })) ?? [];
    this.expansionsByName = new Map(list.map((e) => [e.name.toLowerCase(), e]));
    return this.expansionsByName;
  }

  private async blueprintsFor(expansionId: number): Promise<CardTraderBlueprint[]> {
    const cached = this.blueprintsByExpansion.get(expansionId);
    if (cached) return cached;
    const list =
      (await this.get<CardTraderBlueprint[]>("/blueprints/export", {
        expansion_id: String(expansionId),
      })) ?? [];
    this.blueprintsByExpansion.set(expansionId, list);
    return list;
  }

  /** Resolves one printing to its CardTrader blueprint id, or null if it can't be found. */
  async resolveBlueprint(setName: string, cardName: string, finish: string): Promise<number | null> {
    const expansion = (await this.expansions()).get(setName.toLowerCase());
    if (!expansion) return null;
    const blueprints = await this.blueprintsFor(expansion.id);
    const nameMatch = blueprints.filter(
      (b) => b.name.toLowerCase() === cardName.toLowerCase(),
    );
    if (nameMatch.length === 0) return null;
    const versioned = nameMatch.find((b) => versionMatches(finish, b.version));
    return (versioned ?? nameMatch[0])!.id;
  }

  async fetchPrices(variantRefs: VariantRef[]): Promise<FetchedPrice[]> {
    const results: FetchedPrice[] = [];
    for (const ref of variantRefs) {
      const blueprintId = ref.externalIds.cardtraderBlueprintId
        ? Number(ref.externalIds.cardtraderBlueprintId)
        : await this.resolveBlueprint(ref.setName, ref.cardName, ref.finish);
      if (!blueprintId) continue;

      const products = await this.get<CardTraderProduct[]>("/marketplace/products", {
        blueprint_id: String(blueprintId),
      });
      if (!products || products.length === 0) continue;

      const inLanguage = products.filter(
        (p) => !ref.languageCode || (p.properties_hash?.pokemon_language ?? "en") === ref.languageCode,
      );
      const pool = inLanguage.length > 0 ? inLanguage : products;
      const cents = pool.map((p) => p.price_cents).filter((n) => Number.isFinite(n) && n > 0);
      if (cents.length === 0) continue;

      results.push({
        variantId: ref.variantId,
        currency: pool[0]!.price_currency || "EUR",
        low: toMinor(Math.min(...cents)),
        mid: toMinor(median(cents)),
        observedAt: new Date().toISOString(),
      });
    }
    return results;
  }

  buildLink(variant: VariantRef): string {
    return `https://www.cardtrader.com/cards?search=${encodeURIComponent(variant.cardName)}`;
  }
}
