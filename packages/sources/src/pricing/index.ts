import { TcgcsvPriceClient } from "./tcgcsv-prices";
import type { PriceProviderId } from "@tcg-vault/shared";
import { CardTraderProvider } from "./cardtrader";
import { EbayProvider } from "./ebay";
import { TcgdexMarketProvider, TcgdexPriceClient } from "./tcgdex-prices";
import type { PriceProvider } from "./types";

export * from "./cardtrader";
export * from "./ebay";
export * from "./ebay-filter";
export * from "./grading";
export * from "./http";
export * from "./matching";
export * from "./tcgdex-prices";
export * from "./types";

export interface ProviderCredentials {
  cardtraderToken?: string | null;
  ebayClientId?: string | null;
  ebayClientSecret?: string | null;
  ebayMarketplaceId?: string | null;
  ebayEnvironment?: "production" | "sandbox" | null;
}

/** Every price provider, configured with the user's credentials. */
export function createPriceProviders(
  credentials: ProviderCredentials,
  options: { fetch?: typeof fetch } = {},
): Record<PriceProviderId, PriceProvider> {
  const tcgdex = new TcgdexPriceClient({ fetch: options.fetch });
  return {
    cardmarket: new TcgdexMarketProvider("cardmarket", tcgdex),
    tcgplayer: new TcgdexMarketProvider("tcgplayer", tcgdex, new TcgcsvPriceClient({ fetch: options.fetch })),
    cardtrader: new CardTraderProvider({
      token: credentials.cardtraderToken,
      fetch: options.fetch,
    }),
    ebay: new EbayProvider({
      clientId: credentials.ebayClientId,
      clientSecret: credentials.ebayClientSecret,
      marketplaceId: credentials.ebayMarketplaceId ?? undefined,
      environment: credentials.ebayEnvironment ?? undefined,
      fetch: options.fetch,
    }),
  };
}
