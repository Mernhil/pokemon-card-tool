import { currencyDecimals } from "@tcg-vault/shared";
import {
  AuthError,
  NotConfiguredError,
  createThrottle,
  median,
  requestJson,
  toMinorUnits,
} from "./http";
import { ebayQueryFor, filterListings, type EbayListing } from "./ebay-filter";
import type {
  PriceProvider,
  PricedCard,
  ProviderCapabilities,
  ProviderObservation,
  ResolvedMapping,
} from "./types";

/**
 * eBay, through the Browse API's item_summary/search: ACTIVE listings only.
 * eBay's sold-listings API (Marketplace Insights) is restricted and not open
 * to new developers, so there is no `sold` data here — every number is an
 * asking price and is labelled as such. Scraping sold listings would break
 * eBay's terms; we don't.
 *
 * Auth: the OAuth "client credentials" grant with the user's own Client ID +
 * Client Secret (Settings) mints an application token (~2 h), cached here.
 * Budget: the Browse API allows 5,000 calls/day by default; the refresh job
 * caps eBay runs well below that.
 *
 * What we store per refresh: the median and the lowest price of the
 * listings that survive the junk filters (ebay-filter.ts), with how many
 * there were. No seller or buyer data is stored.
 *
 * Request/response field names follow eBay's API docs; not verified live.
 */

/** eBay's category for individual Pokémon TCG cards ("CCG Individual Cards"). */
export const EBAY_POKEMON_SINGLES_CATEGORY = "183454";

export interface EbayOptions {
  clientId: string | null | undefined;
  clientSecret: string | null | undefined;
  /** EBAY_US, EBAY_GB, EBAY_DE, EBAY_IT, EBAY_FR, EBAY_ES, ... */
  marketplaceId?: string;
  environment?: "production" | "sandbox";
  fetch?: typeof fetch;
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value?: string; currency?: string };
  buyingOptions?: string[];
  conditionId?: string;
}

/** Pure: Browse API response -> listings with minor-unit prices. */
export function parseEbaySearch(data: unknown): EbayListing[] {
  const items = (data as { itemSummaries?: EbayItemSummary[] } | null)?.itemSummaries ?? [];
  const out: EbayListing[] = [];
  for (const item of items) {
    const currency = item.price?.currency?.toUpperCase();
    if (!currency || !item.title) continue;
    const price = toMinorUnits(item.price?.value, currencyDecimals(currency));
    if (price === null) continue;
    out.push({
      itemId: item.itemId,
      title: item.title,
      price,
      currency,
      buyingOptions: item.buyingOptions,
      conditionId: item.conditionId,
    });
  }
  return out;
}

/** Pure: surviving listings -> asking (median) + lowest listing, per currency. */
export function ebayObservations(
  listings: EbayListing[],
  { now = new Date(), payloadHash = null }: { now?: Date; payloadHash?: string | null } = {},
): ProviderObservation[] {
  const out: ProviderObservation[] = [];
  for (const currency of new Set(listings.map((l) => l.currency))) {
    const prices = listings.filter((l) => l.currency === currency).map((l) => l.price);
    const base = {
      currency,
      condition: null,
      listingCount: prices.length,
      observedAt: now,
      payloadHash,
    };
    out.push({ kind: "asking", amount: median(prices), ...base });
    out.push({ kind: "lowest_listing", amount: Math.min(...prices), ...base });
  }
  return out;
}

export class EbayProvider implements PriceProvider {
  readonly id = "ebay" as const;
  readonly label = "eBay";
  readonly capabilities: ProviderCapabilities = {
    supportsSold: false,
    supportsHistory: false,
    kinds: ["asking", "lowest_listing"],
    rateLimit: { requests: 5_000, perMs: 86_400_000, note: "Browse API default: 5,000 calls/day" },
    needsCredentials: true,
    games: ["pokemon"],
  };

  private token: { value: string; expiresAt: number } | null = null;
  private readonly throttle = createThrottle(1_000);

  constructor(private readonly options: EbayOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.clientId && this.options.clientSecret);
  }

  private get host(): string {
    return this.options.environment === "sandbox"
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";
  }

  private get marketplaceId(): string {
    return this.options.marketplaceId || "EBAY_US";
  }

  /** Application access token via the client credentials grant, cached until shortly before expiry. */
  private async accessToken(): Promise<string> {
    if (!this.isConfigured())
      throw new NotConfiguredError(this.id, "Client ID / Client Secret not set");
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString(
      "base64",
    );
    try {
      const { data } = await requestJson<{ access_token?: string; expires_in?: number }>(
        `${this.host}/identity/v1/oauth2/token`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "https://api.ebay.com/oauth/api_scope",
          }).toString(),
        },
        { provider: this.id, fetch: this.options.fetch },
      );
      if (!data.access_token) throw new AuthError(this.id, "eBay returned no access token");
      this.token = {
        value: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
      };
      return this.token.value;
    } catch (err) {
      // eBay answers bad client credentials with 400/401 "invalid_client".
      if (err instanceof Error && /invalid_client|HTTP 400/.test(err.message)) {
        throw new AuthError(this.id, `eBay rejected the Client ID / Secret: ${err.message}`);
      }
      throw err;
    }
  }

  async resolveMapping(card: PricedCard): Promise<ResolvedMapping | null> {
    if (!this.isConfigured()) return null;
    const query = ebayQueryFor(card);
    return {
      externalId: null,
      query,
      url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=${EBAY_POKEMON_SINGLES_CATEGORY}`,
      // A search, not an id: the listing filters decide what counts, so it's
      // "matched" — but each refresh says how many listings survived.
      confidence: 0.8,
      status: "matched",
      notes: "Search query + listing filters (lots, proxies, graded, language, number, name)",
    };
  }

  async fetchPrices(card: PricedCard, mapping: ResolvedMapping): Promise<ProviderObservation[]> {
    const q = mapping.query ?? ebayQueryFor(card);
    const params = new URLSearchParams({
      q,
      category_ids: EBAY_POKEMON_SINGLES_CATEGORY,
      filter: "buyingOptions:{FIXED_PRICE}",
      limit: "100",
    });
    const token = await this.accessToken();
    const { data, hash } = await requestJson<unknown>(
      `${this.host}/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
          Accept: "application/json",
        },
      },
      { provider: this.id, fetch: this.options.fetch, throttle: this.throttle },
    );
    const { accepted } = filterListings(parseEbaySearch(data), card);
    return ebayObservations(accepted, { payloadHash: hash });
  }

  async testConnection() {
    if (!this.isConfigured()) return { ok: false, message: "Client ID / Client Secret not set" };
    try {
      await this.accessToken();
      return {
        ok: true,
        message: `Got an application token (${this.options.environment ?? "production"}, ${this.marketplaceId}).`,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
