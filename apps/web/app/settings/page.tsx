import {
  EBAY_MARKETPLACES,
  getSettings,
  imageCacheDir,
  imageCacheStats,
  loadFxRates,
  prisma,
  secretStatus,
  secretsPath,
} from "@tcg-vault/db";
import { PRICE_PROVIDERS, displayCurrencies } from "@tcg-vault/shared";
import { PageHeader } from "../../components/ui/page-header";
import { priceProviders } from "../../lib/background";
import { loadMoneyDisplay } from "../../lib/money-config";
import { SettingsForm, type ProviderView } from "./settings-form";

export const dynamic = "force-dynamic";

/** Only these secret names belong to each provider. */
const PROVIDER_SECRETS: Record<string, Array<{ name: string; label: string }>> = {
  cardtrader: [{ name: "cardtraderToken", label: "API token" }],
  ebay: [
    { name: "ebayClientId", label: "Client ID (App ID)" },
    { name: "ebayClientSecret", label: "Client Secret (Cert ID)" },
  ],
};

const PROVIDER_NOTES: Record<string, string> = {
  cardmarket:
    "Cardmarket's price guide numbers (trend, average sale, lowest listing, EUR) as relayed by TCGdex, about daily. No key needed — Cardmarket's own API isn't open to new users.",
  tcgplayer:
    "TCGplayer market price (from recent sales), median and lowest listing in USD, relayed by TCGdex. No key needed.",
  cardtrader:
    "Cheapest current listings per condition, from your CardTrader account's API token. Listings only — CardTrader has no sold-price history.",
  ebay: "Active fixed-price listings via the Browse API (median asking price + lowest), after filtering out lots, proxies, graded slabs and other languages. Sold prices need eBay's restricted Marketplace Insights API, so none are shown.",
};

export default async function SettingsPage() {
  await loadMoneyDisplay();
  const [settings, secrets, health, rates, cache, { providers }] = await Promise.all([
    getSettings(),
    secretStatus(),
    prisma.providerStatus.findMany(),
    loadFxRates(),
    imageCacheStats(),
    priceProviders(),
  ]);

  const providerViews: ProviderView[] = PRICE_PROVIDERS.map((id) => {
    const h = health.find((x) => x.provider === id);
    const p = providers[id];
    return {
      id,
      label: p.label,
      note: PROVIDER_NOTES[id] ?? "",
      enabled: settings.providers[id].enabled,
      configured: p.isConfigured(),
      needsCredentials: p.capabilities.needsCredentials,
      kinds: p.capabilities.kinds,
      rateLimit: p.capabilities.rateLimit.note,
      secrets: (PROVIDER_SECRETS[id] ?? []).map((s) => ({
        ...s,
        ...secrets[s.name as keyof typeof secrets],
      })),
      lastSuccessAt: h?.lastSuccessAt?.getTime() ?? null,
      lastErrorAt: h?.lastErrorAt?.getTime() ?? null,
      lastError: h?.lastError ?? null,
      rateLimitedUntil:
        h?.rateLimitedUntil && h.rateLimitedUntil.getTime() > Date.now()
          ? h.rateLimitedUntil.getTime()
          : null,
    };
  });

  return (
    <main className="page max-w-4xl">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        subtitle="Price sources and their keys, currency, and how often things refresh."
      />
      <SettingsForm
        settings={settings}
        providers={providerViews}
        currencies={displayCurrencies(rates)}
        rates={{ source: rates.source, asOf: rates.asOf }}
        marketplaces={[...EBAY_MARKETPLACES]}
        storage={{
          secretsFile: secretsPath(),
          cacheDir: imageCacheDir(),
          cacheBytes: cache.bytes,
          cacheFiles: cache.files,
          pinnedBytes: cache.pinnedBytes,
        }}
      />
    </main>
  );
}
