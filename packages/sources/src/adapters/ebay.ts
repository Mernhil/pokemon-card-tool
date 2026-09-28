import type { FetchedPrice, PriceSourceAdapter, VariantRef } from "../types";

/**
 * eBay's actual sold-price API (Marketplace Insights) is invite-only —
 * regular developer accounts can't get completed-sale prices at all. This
 * adapter uses the open Browse API instead, which only returns *active*
 * (asking) listings. That's a real limitation, not a shortcut: an asking
 * price is not a transacted price, so callers must record these as
 * EBAY_ACTIVE (packages/shared/src/enums.ts PriceSourceKind), never
 * EBAY_SOLD, and should weight it accordingly (see packages/pricing's
 * resolveAnchor).
 *
 * Needs EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (see .env.example) for eBay's
 * client-credentials OAuth flow — no user account involved, just an app
 * token, refreshed automatically as it nears expiry.
 */

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
/** eBay's category for "CCG Individual Cards" (Pokémon lives under it). */
const CCG_CARDS_CATEGORY = "183454";

export interface EbayCredentials {
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

function toMinor(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Best-effort search text: card name, set/collector number, and a finish hint eBay sellers actually use. */
export function queryFor(ref: VariantRef): string {
  const finishHint =
    ref.finish === "REVERSE_HOLO"
      ? "reverse holo"
      : ref.finish === "NON_FOIL"
        ? ""
        : ref.finish.replace(/_/g, " ").toLowerCase();
  return [ref.cardName, ref.collectorNumber, finishHint, "pokemon card"]
    .filter(Boolean)
    .join(" ");
}

export class EbayActiveListingsAdapter implements PriceSourceAdapter {
  readonly slug = "ebay-browse-active";
  private token: CachedToken | null = null;

  constructor(
    private readonly credentials: EbayCredentials,
    /** eBay marketplace to search, e.g. "EBAY_US", "EBAY_GB", "EBAY_IT", "EBAY_DE". */
    private readonly marketplaceId: string = "EBAY_US",
  ) {}

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
    });
    if (!res.ok) {
      throw new Error(`eBay OAuth token request failed: HTTP ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.token.value;
  }

  /**
   * One search per variant (eBay's Browse API has no batch endpoint). Best
   * effort: a variant eBay errors on or returns nothing for is skipped
   * rather than failing the whole batch — sparse/no eBay data for a card is
   * normal, not exceptional.
   */
  async fetchPrices(variantRefs: VariantRef[]): Promise<FetchedPrice[]> {
    if (variantRefs.length === 0) return [];
    const token = await this.getToken();
    const results: FetchedPrice[] = [];

    for (const ref of variantRefs) {
      const params = new URLSearchParams({
        q: queryFor(ref),
        category_ids: CCG_CARDS_CATEGORY,
        limit: "50",
        filter: "buyingOptions:{FIXED_PRICE},itemLocationCountry:US",
      });
      let res: Response;
      try {
        res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
          },
        });
      } catch {
        continue; // network hiccup on one card shouldn't drop the rest
      }
      if (!res.ok) continue;

      const data = (await res.json().catch(() => null)) as {
        itemSummaries?: Array<{ price?: { value?: string; currency?: string } }>;
      } | null;
      const items = data?.itemSummaries ?? [];
      const prices = items
        .map((i) => Number(i.price?.value))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (prices.length === 0) continue;

      const currency = items.find((i) => i.price?.currency)?.price?.currency ?? "USD";
      results.push({
        variantId: ref.variantId,
        currency,
        low: toMinor(Math.min(...prices)),
        mid: toMinor(median(prices)),
        observedAt: new Date().toISOString(),
      });
    }
    return results;
  }

  buildLink(variant: VariantRef): string {
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(queryFor(variant))}&_sacat=${CCG_CARDS_CATEGORY}`;
  }
}
