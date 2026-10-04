import {
  getSettings,
  loadFxRates,
  pricePoints,
  pricesUpdating,
  prisma,
  type AppSettings,
} from "@tcg-vault/db";
import {
  LANGUAGE_AWARE_PROVIDERS,
  headlinePrice,
  latestRefresh,
  pointsForLanguage,
  type LanguageMode,
  type PricePoint,
} from "@tcg-vault/pricing";
import {
  MIN_TRUSTED_MATCH,
  PRICE_PROVIDERS,
  priceLanguageLabel,
  convertMinor,
  type FxRates,
  type PriceKind,
  type PriceProviderId,
} from "@tcg-vault/shared";
import { priceProviders, runnablePriceProviders } from "./background";

/**
 * Everything the card page's Prices section shows, read from the DB only —
 * the page never waits on a live API call (stale prices are queued for the
 * background refresh instead; see app/[game]/[set]/[number]/page.tsx).
 */

export type PanelState =
  | "ok"
  | "no_data"
  | "no_language"
  | "not_configured"
  | "disabled"
  | "rate_limited"
  | "not_found"
  | "error";

/** A price point with its date as a number, so it can be passed to client components. */
export interface SerializedPoint {
  provider: string;
  kind: PriceKind;
  amount: number;
  currency: string;
  condition: string | null;
  listingCount: number | null;
  t: number;
}

export interface ProviderPanelData {
  id: PriceProviderId;
  label: string;
  state: PanelState;
  /** Why the state is what it is ("API key not set", the last error, ...). */
  message: string | null;
  headline: SerializedPoint | null;
  /** The other numbers from the same refresh (other kinds / conditions). */
  others: SerializedPoint[];
  /** When this provider last returned something for this card. */
  updatedAt: number | null;
  mapping: {
    status: string;
    confidence: number;
    notes: string | null;
    url: string | null;
    externalId: string | null;
    query: string | null;
    manualOverride: boolean;
  } | null;
  /**
   * How the numbers relate to the selected price language: "all-languages" = this
   * provider can't split by language (Cardmarket, TCGplayer), "unsplit" = its
   * listings didn't say, "language" = exactly the selected language.
   */
  languageMode: LanguageMode;
  /** Low-confidence match: shown with a warning, left out of "Best value" and valuations. */
  untrusted: boolean;
  supportsSold: boolean;
}

export const PROVIDER_COLORS: Record<PriceProviderId, string> = {
  cardmarket: "var(--series-1)",
  tcgplayer: "var(--series-2)",
  cardtrader: "var(--series-3)",
  ebay: "var(--series-4)",
};

const serialize = (p: PricePoint): SerializedPoint => ({
  provider: p.provider,
  kind: p.kind,
  amount: p.amount,
  currency: p.currency,
  condition: p.condition,
  listingCount: p.listingCount,
  t: p.observedAt.getTime(),
});

/** The marketplace's own product page (with its listings), when we know the product id. */
function productUrl(provider: PriceProviderId, externalId: string | null): string | null {
  if (!externalId || !/^\d+$/.test(externalId)) return null;
  if (provider === "cardmarket")
    return `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${externalId}`;
  if (provider === "tcgplayer") return `https://www.tcgplayer.com/product/${externalId}`;
  return null;
}

/** Where to look the card up on a provider when we have no product link. */
function searchUrl(provider: PriceProviderId, name: string, number: string, game: string): string {
  const q = encodeURIComponent(`${name} ${number.split("/")[0]}`);
  switch (provider) {
    case "cardmarket": {
      const cmGame = { yugioh: "YuGiOh", "one-piece": "OnePiece" }[game] ?? "Pokemon";
      return `https://www.cardmarket.com/en/${cmGame}/Products/Search?searchString=${q}`;
    }
    case "tcgplayer": {
      const tpGame = { yugioh: "yugioh", "one-piece": "one-piece-card-game" }[game] ?? "pokemon";
      return `https://www.tcgplayer.com/search/${tpGame}/product?q=${q}`;
    }
    case "cardtrader":
      return `https://www.cardtrader.com/search?q=${q}`;
    case "ebay":
      return `https://www.ebay.com/sch/i.html?_nkw=${q}`;
  }
}

export interface CardPrices {
  settings: AppSettings;
  rates: FxRates;
  panels: ProviderPanelData[];
  points: SerializedPoint[];
  updating: boolean;
  /** The language the panels are filtered to (the setting unless the page asked for another). */
  language: string;
  /** True when the selected language has no data yet from a provider that can look it up. */
  languageMissing: boolean;
  /** Some enabled, configured provider can actually split prices by language. */
  languageFilterable: boolean;
}

export async function loadCardPrices(
  variantId: string,
  allVariantIds: string[],
  card: { name: string; number: string; game: string },
  requestedLanguage?: string,
): Promise<CardPrices> {
  const now = Date.now();
  const [settings, rates, pointsByVariant, mappings, health, updating, { providers }] =
    await Promise.all([
      getSettings(),
      loadFxRates(),
      pricePoints([variantId]),
      prisma.providerMapping.findMany({ where: { variantId } }),
      prisma.providerStatus.findMany(),
      pricesUpdating(allVariantIds, { game: card.game, providers: await runnablePriceProviders(card.game) }),
      priceProviders(),
    ]);
  const allPoints = pointsByVariant.get(variantId) ?? [];
  const language = requestedLanguage ?? settings.priceLanguage;
  const scopedByProvider = new Map(
    PRICE_PROVIDERS.map((id) => [id, pointsForLanguage(id, allPoints, language)]),
  );
  const points = [...scopedByProvider.values()].flatMap((s) => s.points);
  let languageMissing = false;
  const languageFilterable = [...LANGUAGE_AWARE_PROVIDERS].some(
    (id) =>
      (PRICE_PROVIDERS as readonly string[]).includes(id) &&
      providers[id as PriceProviderId].isConfigured() &&
      settings.providers[id as PriceProviderId].enabled,
  );

  const panels = PRICE_PROVIDERS.map((id): ProviderPanelData => {
    const provider = providers[id];
    const mappingRow = mappings.find((m) => m.provider === id) ?? null;
    const status = health.find((h) => h.provider === id);
    const scoped = scopedByProvider.get(id)!;
    const own = scoped.points;
    const headline = headlinePrice(id, own);
    const refresh = latestRefresh(id, own);
    const untrusted =
      !!mappingRow &&
      mappingRow.status === "low_confidence" &&
      mappingRow.confidence < MIN_TRUSTED_MATCH;

    let state: PanelState = headline ? "ok" : "no_data";
    let message: string | null = null;
    // Has data, but none in this language: say so instead of showing another language's number.
    const noLanguage = scoped.mode === "other-languages";
    if (noLanguage) {
      state = "no_language";
      message =
        id === "tcgplayer"
          ? "TCGplayer only sells English cards — choose English to see its prices"
          : `No ${priceLanguageLabel(language)} listings found`;
    }
    if (noLanguage && provider.isConfigured() && settings.providers[id].enabled) {
      // Keep the language message.
    } else if (!settings.providers[id].enabled) {
      state = headline ? "ok" : "disabled";
      message = "Turned off in Settings";
    } else if (!provider.isConfigured()) {
      state = headline ? "ok" : "not_configured";
      message = "API key not set";
    } else if (status?.rateLimitedUntil && status.rateLimitedUntil.getTime() > now) {
      state = headline ? "ok" : "rate_limited";
      message = `Rate limited — retrying after ${status.rateLimitedUntil.toLocaleTimeString()}`;
    } else if (mappingRow?.status === "not_found") {
      state = headline ? "ok" : "not_found";
      message = mappingRow.notes ?? "No match found";
    } else if (
      !headline &&
      status?.lastErrorAt &&
      (!status.lastSuccessAt || status.lastErrorAt > status.lastSuccessAt)
    ) {
      state = "error";
      message = status.lastError;
    }

    return {
      id,
      label: provider.label,
      state,
      message,
      headline: headline ? serialize(headline) : null,
      others: refresh
        .filter(
          (p) =>
            !headline ||
            p.kind !== headline.kind ||
            p.condition !== headline.condition ||
            p.currency !== headline.currency,
        )
        .map(serialize),
      updatedAt: own.length ? Math.max(...own.map((p) => p.observedAt.getTime())) : null,
      mapping: mappingRow
        ? {
            status: mappingRow.status,
            confidence: mappingRow.confidence,
            notes: mappingRow.notes,
            url: mappingRow.url ?? productUrl(id, mappingRow.externalId) ?? searchUrl(id, card.name, card.number, card.game),
            externalId: mappingRow.externalId,
            query: mappingRow.query,
            manualOverride: mappingRow.manualOverride,
          }
        : null,
      untrusted,
      languageMode: scoped.mode,
      supportsSold: provider.capabilities.supportsSold,
    };
  });

  // A language-aware provider that has never been asked about this language (eBay looks one
  // language up at a time) and no stored number: a refresh for it can still find listings.
  for (const id of ["ebay"] as const) {
    const s = scopedByProvider.get(id)!;
    if (
      s.mode !== "language" &&
      providers[id].isConfigured() &&
      settings.providers[id].enabled &&
      language !== settings.priceLanguage
    )
      languageMissing = true;
  }

  return {
    settings,
    rates,
    panels,
    points: points.map(serialize),
    updating,
    language,
    languageMissing,
    languageFilterable,
  };
}

export interface BestValue {
  lowest: { panel: ProviderPanelData; amount: number; converted: boolean } | null;
  highest: { panel: ProviderPanelData; amount: number; converted: boolean } | null;
  /** Display-currency minor units. */
  spread: number | null;
  currency: string;
  /** Some compared prices were converted between currencies. */
  converted: boolean;
  /** Providers left out: no exchange rate for their currency. */
  unconvertible: string[];
  /** Providers left out: uncertain match. */
  untrusted: string[];
  /** The compared prices aren't all the same kind (e.g. a listing vs a sales average). */
  mixedKinds: boolean;
}

/** Lowest / highest current headline across providers, in the display currency. */
export function bestValue(
  panels: ProviderPanelData[],
  currency: string,
  rates: FxRates,
): BestValue {
  const priced: Array<{ panel: ProviderPanelData; amount: number; converted: boolean }> = [];
  const unconvertible: string[] = [];
  let converted = false;
  for (const panel of panels) {
    if (!panel.headline || panel.untrusted) continue;
    const amount = convertMinor(panel.headline.amount, panel.headline.currency, currency, rates);
    if (amount === null) {
      unconvertible.push(panel.label);
      continue;
    }
    const wasConverted = panel.headline.currency !== currency;
    if (wasConverted) converted = true;
    priced.push({ panel, amount, converted: wasConverted });
  }
  priced.sort((a, b) => a.amount - b.amount);
  const lowest = priced[0] ?? null;
  const highest = priced.length > 1 ? priced[priced.length - 1]! : null;
  return {
    lowest,
    highest,
    spread: lowest && highest ? highest.amount - lowest.amount : null,
    currency,
    converted,
    unconvertible,
    untrusted: panels.filter((p) => p.untrusted && p.headline).map((p) => p.label),
    mixedKinds: new Set(priced.map((p) => p.panel.headline!.kind)).size > 1,
  };
}
