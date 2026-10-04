import { TCGDEX_LANGUAGES, type PriceKind, type PriceProviderId } from "@tcg-vault/shared";
import { pricesFor, type TcgdexPricing } from "../adapters/tcgdex";
import type { SourcePriceQuote } from "../types";
import { createThrottle, requestJson } from "./http";
import type {
  PriceProvider,
  PricedCard,
  ProviderCapabilities,
  ProviderObservation,
  ResolvedMapping,
} from "./types";

/**
 * Cardmarket and TCGplayer prices as relayed by TCGdex with every card — no
 * API key needed. Cardmarket's own API isn't open to new users, so this is
 * how Cardmarket numbers get into the app (see docs/setup.md).
 *
 * TCGdex refreshes Cardmarket about daily and TCGplayer hourly-to-daily;
 * each number carries TCGdex's own `updated` timestamp, and a refresh that
 * finds the same timestamp again doesn't add a duplicate observation.
 */

/** What each quote field *is*, per marketplace — so the UI never mislabels a price. */
const QUOTE_KINDS: Record<
  string,
  Partial<Record<"low" | "mid" | "market" | "trend", PriceKind>>
> = {
  // Cardmarket price guide: avg = average sell price, trend = trend price, low = cheapest listing.
  CARDMARKET: { trend: "trend", mid: "market_average", low: "lowest_listing" },
  // TCGplayer: market = based on recent sales, mid = median listing, low = cheapest listing.
  TCGPLAYER: { market: "market_average", mid: "asking", low: "lowest_listing" },
};

/** One TCGdex quote (a finish x marketplace) -> one observation per number it carries. */
export function quoteToObservations(
  quote: SourcePriceQuote,
  { now = new Date(), payloadHash = null }: { now?: Date; payloadHash?: string | null } = {},
): ProviderObservation[] {
  const kinds = QUOTE_KINDS[quote.source] ?? {};
  const parsed = quote.observedAt ? new Date(quote.observedAt) : null;
  const observedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
  const out: ProviderObservation[] = [];
  for (const field of ["trend", "market", "mid", "low"] as const) {
    const amount = quote[field];
    const kind = kinds[field];
    if (amount === undefined || !kind) continue;
    out.push({
      kind,
      amount,
      currency: quote.currency,
      condition: null,
      listingCount: null,
      observedAt,
      payloadHash,
    });
  }
  return out;
}

/** The TCGdex language id of a card's own language ("zh-Hant" -> "zh-tw"). */
export function tcgdexLanguageOf(card: Pick<PricedCard, "languageCode">): string {
  const code = card.languageCode || "en";
  return TCGDEX_LANGUAGES.find((l) => l.code === code)?.tcgdex ?? code;
}

/** Sets that come from tcgcsv (promos TCGdex lacks), not TCGdex: see adapters/tcgcsv-promos.ts. */
const NOT_TCGDEX_SET = /^(JP|EN)-/;

/**
 * The TCGdex card id for one of our printings, or null when TCGdex doesn't
 * have it (tcgcsv promos). Each language is its own TCGdex catalog, with its
 * own ids and its own Cardmarket products.
 */
export function tcgdexCardId(card: PricedCard): string | null {
  const lang = tcgdexLanguageOf(card);
  const known = card.externalIds[lang === "en" ? "tcgdex-pokemon" : `tcgdex-pokemon-${lang}`];
  if (known) return known;
  if (lang !== "en" || NOT_TCGDEX_SET.test(card.setCode)) return null;
  // "001/30" inside a 128-card set is a gallery TCGdex files as its own set ("30th-c"):
  // guessing "30th-001" would price a different card.
  const total = Number(card.collectorNumber.split("/")[1]);
  if (total && card.printedTotal && total !== card.printedTotal) return null;
  return `${card.setCode}-${card.collectorNumber.split("/")[0]}`;
}

/**
 * Fetches a card's `pricing` once for both TCGdex-backed providers (they'd
 * otherwise each request the same card), with a short in-memory cache.
 */
export class TcgdexPriceClient {
  private readonly cache = new Map<
    string,
    { at: number; value: Promise<{ pricing?: TcgdexPricing; hash: string }> }
  >();
  private readonly throttle = createThrottle(250);

  constructor(
    private readonly options: {
      fetch?: typeof fetch;
      lang?: string;
      baseUrl?: string;
      cacheMs?: number;
    } = {},
  ) {}

  card(id: string, lang = this.options.lang ?? "en"): Promise<{ pricing?: TcgdexPricing; hash: string }> {
    const now = Date.now();
    const key = `${lang}/${id}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < (this.options.cacheMs ?? 10 * 60_000)) return hit.value;
    const base = this.options.baseUrl ?? "https://api.tcgdex.net/v2";
    const value = requestJson<{ pricing?: TcgdexPricing }>(
      `${base}/${lang}/cards/${encodeURIComponent(id)}`,
      { headers: { Accept: "application/json" } },
      { provider: "tcgdex", fetch: this.options.fetch, throttle: this.throttle },
    ).then(({ data, hash }) => ({ pricing: data.pricing, hash }));
    value.catch(() => this.cache.delete(key));
    this.cache.set(key, { at: now, value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}

const SOURCE_FOR: Record<"cardmarket" | "tcgplayer", string> = {
  cardmarket: "CARDMARKET",
  tcgplayer: "TCGPLAYER",
};

export class TcgdexMarketProvider implements PriceProvider {
  readonly label: string;
  readonly capabilities: ProviderCapabilities;

  constructor(
    readonly id: Extract<PriceProviderId, "cardmarket" | "tcgplayer">,
    private readonly client: TcgdexPriceClient,
  ) {
    this.label = id === "cardmarket" ? "Cardmarket (via TCGdex)" : "TCGplayer (via TCGdex)";
    this.capabilities = {
      supportsSold: false,
      supportsHistory: false,
      kinds:
        id === "cardmarket"
          ? ["trend", "market_average", "lowest_listing"]
          : ["market_average", "asking", "lowest_listing"],
      rateLimit: {
        requests: 4,
        perMs: 1_000,
        note: "self-imposed; TCGdex is a free community API",
      },
      needsCredentials: false,
      games: ["pokemon"],
    };
  }

  isConfigured(): boolean {
    return true;
  }

  private async quotes(card: PricedCard) {
    const id = tcgdexCardId(card);
    if (!id) return { quotes: [] as SourcePriceQuote[], hash: "", noTcgdex: true };
    const { pricing, hash } = await this.client.card(id, tcgdexLanguageOf(card));
    const quotes = pricesFor(pricing, card.printingFinishes).filter(
      (q) => q.source === SOURCE_FOR[this.id] && q.finish === card.finish,
    );
    return { quotes, hash, noTcgdex: false };
  }

  async resolveMapping(card: PricedCard): Promise<ResolvedMapping> {
    const { quotes, noTcgdex } = await this.quotes(card);
    const quote = quotes[0];
    if (noTcgdex) {
      // Not a TCGdex card (a tcgcsv promo): its prices came with the catalog, so keep that link.
      const own = card.externalIds[this.id];
      return own
        ? {
            externalId: own,
            query: null,
            url:
              this.id === "tcgplayer" ? `https://www.tcgplayer.com/product/${encodeURIComponent(own)}` : null,
            confidence: 1,
            status: "matched",
            notes: "Priced with the catalog",
          }
        : {
            externalId: null,
            query: null,
            url: null,
            confidence: 0,
            status: "not_found",
            notes: "No Cardmarket price for this promo",
          };
    }
    if (!quote) {
      return {
        externalId: null,
        query: null,
        url: null,
        confidence: 0,
        status: "not_found",
        notes: `TCGdex has no ${this.id === "cardmarket" ? "Cardmarket" : "TCGplayer"} price for this card/finish`,
      };
    }
    return {
      externalId: quote.externalId ?? null,
      query: null,
      url:
        this.id === "tcgplayer" && quote.externalId
          ? `https://www.tcgplayer.com/product/${encodeURIComponent(quote.externalId)}`
          : null,
      // TCGdex links its card to the marketplace product itself.
      confidence: 1,
      status: "matched",
      notes: "Linked by TCGdex",
    };
  }

  async fetchPrices(card: PricedCard): Promise<ProviderObservation[]> {
    const { quotes, hash } = await this.quotes(card);
    return quotes.flatMap((q) => quoteToObservations(q, { payloadHash: hash }));
  }

  async testConnection() {
    try {
      await this.client.card("swsh3-136");
      return { ok: true, message: "TCGdex answered." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
