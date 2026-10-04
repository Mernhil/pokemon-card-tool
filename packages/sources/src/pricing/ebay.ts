import { lowestAverage } from "./listing-stats";
import { currencyDecimals } from "@tcg-vault/shared";
import {
  AuthError,
  NotConfiguredError,
  createThrottle,
  median,
  requestJson,
  toMinorUnits,
} from "./http";
import {
  applyListingRules,
  ebayQueryFor,
  filterListings,
  removeOutliers,
  type EbayListing,
} from "./ebay-filter";
import { gradeKey, parseGradedTitle, type GradingCompanyId } from "./grading";
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
  {
    now = new Date(),
    payloadHash = null,
    languageCode = null,
  }: { now?: Date; payloadHash?: string | null; languageCode?: string | null } = {},
): ProviderObservation[] {
  const out: ProviderObservation[] = [];
  for (const currency of new Set(listings.map((l) => l.currency))) {
    const prices = listings.filter((l) => l.currency === currency).map((l) => l.price);
    const base = {
      currency,
      condition: null,
      languageCode,
      listingCount: prices.length,
      observedAt: now,
      payloadHash,
    };
    const sorted = [...prices].sort((a, b) => a - b);
    out.push({ kind: "asking", amount: median(prices), ...base });
    out.push({ kind: "lowest_listing", amount: sorted[0]!, ...base });
    // The same "what a copy really costs" figures as CardTrader: the top of the cheapest few
    // and the average of the cheapest supported listings.
    const top = sorted[Math.min(4, sorted.length - 1)]!;
    if (sorted.length >= 2 && top > sorted[0]!) out.push({ kind: "lowest_5th", amount: top, ...base });
    const avg = lowestAverage(sorted);
    if (avg) out.push({ kind: "lowest_avg", amount: avg.amount, ...base, listingCount: avg.count });
  }
  return out;
}

/** One cell of the graded table: a company's grade, priced from the listings that named it. */
export interface GradedObservation {
  company: GradingCompanyId;
  /** gradeKey(): "10", "10:pristine", "10:black-label", "9.5". */
  gradeKey: string;
  currency: string;
  /** Median asking price, and the lowest, in minor units. */
  median: number;
  low: number;
  listingCount: number;
  languageCode: string | null;
}

/** The companies searched for (one request each); others (TAG, ACE) still parse if they turn up. */
export const GRADED_SEARCH_COMPANIES = ["PSA", "BGS", "CGC", "SGC"] as const;

/**
 * Pure: listings that passed the card rules -> one row per company x grade x
 * currency. Listings whose title doesn't name a company and a grade are left
 * out; price outliers are dropped within one company+grade (a PSA 10 and a
 * PSA 5 of the same card are nowhere near each other, on purpose).
 */
export function gradedObservations(
  listings: EbayListing[],
  languageCode: string | null = null,
): GradedObservation[] {
  const groups = new Map<
    string,
    { company: GradingCompanyId; key: string; currency: string; items: EbayListing[] }
  >();
  for (const listing of listings) {
    const parsed = parseGradedTitle(listing.title);
    if (!parsed) continue;
    const key = gradeKey(parsed.grade, parsed.tier);
    const id = `${parsed.company}|${key}|${listing.currency}`;
    const group = groups.get(id) ?? {
      company: parsed.company,
      key,
      currency: listing.currency,
      items: [],
    };
    group.items.push(listing);
    groups.set(id, group);
  }
  const out: GradedObservation[] = [];
  for (const g of groups.values()) {
    const { accepted } = removeOutliers(g.items, []);
    if (accepted.length === 0) continue;
    const prices = accepted.map((l) => l.price);
    out.push({
      company: g.company,
      gradeKey: g.key,
      currency: g.currency,
      median: median(prices),
      low: Math.min(...prices),
      listingCount: prices.length,
      languageCode,
    });
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
    const language = card.priceLanguage ?? card.languageCode;
    // The stored query is language-neutral; for another language the language word is added.
    const q =
      language !== "en"
        ? ebayQueryFor({ ...card, languageCode: language })
        : (mapping.query ?? ebayQueryFor(card));
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
    const { accepted } = filterListings(parseEbaySearch(data), { ...card, languageCode: language });
    return ebayObservations(accepted, { payloadHash: hash, languageCode: language });
  }

  /**
   * Graded prices: one search per grading company ("<card> PSA"), keeping the
   * listings that are this card (same rules as raw prices, minus the graded
   * exclusion) and that name a company + grade. Asking prices only, like the
   * rest of eBay here. Costs one Browse call per company, so callers cache it.
   */
  async fetchGradedPrices(card: PricedCard): Promise<GradedObservation[]> {
    const language = card.priceLanguage ?? card.languageCode;
    const token = await this.accessToken();
    const seen = new Set<string>();
    const listings: EbayListing[] = [];
    for (const company of GRADED_SEARCH_COMPANIES) {
      const params = new URLSearchParams({
        q: `${ebayQueryFor({ ...card, languageCode: language })} ${company}`,
        category_ids: EBAY_POKEMON_SINGLES_CATEGORY,
        filter: "buyingOptions:{FIXED_PRICE}",
        limit: "100",
      });
      const { data } = await requestJson<unknown>(
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
      for (const l of parseEbaySearch(data)) {
        if (seen.has(l.itemId)) continue;
        seen.add(l.itemId);
        listings.push(l);
      }
    }
    const { accepted } = applyListingRules(listings, {
      ...card,
      languageCode: language,
      wantGraded: true,
    });
    return gradedObservations(accepted, language);
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
