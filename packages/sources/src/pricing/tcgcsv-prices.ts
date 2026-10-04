import type { SourcePriceQuote } from "../types";
import { createThrottle, requestJson } from "./http";
import { normalizeName } from "./matching";

/**
 * TCGplayer prices for English cards that TCGdex knows the TCGplayer product of but has no
 * price for (it relays TCGplayer's feed only for part of the catalog). tcgcsv.com mirrors
 * TCGplayer's own daily price lists, one list per set ("group"), keyed by product id:
 * low / mid / high / market and the direct-low price, in USD, per sub-type.
 *
 * Group lookup is by set name ("SWSH10: Astral Radiance Trainer Gallery" -> "Astral Radiance
 * Trainer Gallery") and falls back to the set code (its abbreviation "SWSH10:TG").
 */

const BASE = "https://tcgcsv.com/tcgplayer";
const POKEMON_CATEGORY = 3;

interface Group {
  groupId: number;
  name: string;
  abbreviation?: string | null;
}

interface PriceRow {
  productId: number;
  lowPrice?: number | null;
  midPrice?: number | null;
  marketPrice?: number | null;
  subTypeName?: string | null;
}

/** TCGplayer sub-type -> our finish. 1st Edition and other special sub-types are left out. */
const FINISH_FOR: Record<string, string> = {
  normal: "NON_FOIL",
  holofoil: "HOLO",
  "reverse holofoil": "REVERSE_HOLO",
};

const toMinor = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : undefined;

const stripCode = (name: string) => name.replace(/^[A-Za-z0-9.\-]+:\s*/, "");
const compact = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");

export class TcgcsvPriceClient {
  private groups: { at: number; value: Promise<Group[]> } | null = null;
  private readonly prices = new Map<number, { at: number; value: Promise<PriceRow[]> }>();
  private readonly throttle = createThrottle(250);

  constructor(private readonly options: { fetch?: typeof fetch; cacheMs?: number } = {}) {}

  private get<T>(url: string): Promise<T> {
    return requestJson<{ results?: T }>(
      url,
      { headers: { Accept: "application/json", "User-Agent": "TCG-Vault/1.0 (personal collection tracker)" } },
      { provider: "tcgcsv", fetch: this.options.fetch, throttle: this.throttle },
    ).then(({ data }) => (data.results ?? []) as T);
  }

  private groupList(): Promise<Group[]> {
    const now = Date.now();
    if (this.groups && now - this.groups.at < 24 * 3_600_000) return this.groups.value;
    const value = this.get<Group[]>(`${BASE}/${POKEMON_CATEGORY}/groups`);
    value.catch(() => (this.groups = null));
    this.groups = { at: now, value };
    return value;
  }

  private groupPrices(groupId: number): Promise<PriceRow[]> {
    const now = Date.now();
    const hit = this.prices.get(groupId);
    if (hit && now - hit.at < (this.options.cacheMs ?? 10 * 60_000)) return hit.value;
    const value = this.get<PriceRow[]>(`${BASE}/${POKEMON_CATEGORY}/${groupId}/prices`);
    value.catch(() => this.prices.delete(groupId));
    this.prices.set(groupId, { at: now, value });
    if (this.prices.size > 40) this.prices.delete(this.prices.keys().next().value!);
    return value;
  }

  /** TCGplayer's group for one of our (English) sets, or null. */
  async groupFor(set: { name: string; code: string }): Promise<Group | null> {
    const groups = await this.groupList();
    const name = normalizeName(set.name);
    return (
      groups.find((g) => normalizeName(stripCode(g.name)) === name) ??
      groups.find((g) => g.abbreviation && compact(g.abbreviation) === compact(set.code)) ??
      null
    );
  }

  /** The price quote of one finish of a TCGplayer product, from the set's price list. */
  async quote(
    set: { name: string; code: string },
    productId: number,
    finish: string,
    now = new Date(),
  ): Promise<SourcePriceQuote | null> {
    const group = await this.groupFor(set);
    if (!group) return null;
    const rows = (await this.groupPrices(group.groupId)).filter((r) => r.productId === productId);
    const row =
      rows.find((r) => FINISH_FOR[(r.subTypeName ?? "Normal").toLowerCase()] === finish) ??
      (rows.length === 1 && finish === "NON_FOIL" && !rows[0]!.subTypeName ? rows[0] : undefined);
    if (!row) return null;
    const quote: SourcePriceQuote = {
      finish,
      source: "TCGPLAYER",
      currency: "USD",
      low: toMinor(row.lowPrice),
      mid: toMinor(row.midPrice),
      market: toMinor(row.marketPrice),
      observedAt: now.toISOString(),
      externalId: String(productId),
    };
    return [quote.low, quote.mid, quote.market].some((v) => v !== undefined) ? quote : null;
  }
}
