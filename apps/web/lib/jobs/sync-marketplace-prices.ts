import { syncMarketplacePrices } from "@tcg-vault/db";
import { CardTraderAdapter, EbayActiveListingsAdapter } from "@tcg-vault/sources";

/**
 * CardTrader / eBay pricing on top of the TCGdex-bundled Cardmarket +
 * TCGplayer prices lib/jobs/sync-prices.ts already refreshes nightly.
 * Entirely opt-in via env vars (see .env.example) — with none set this is a
 * no-op, so it's safe to always register in the scheduler.
 */
export async function syncMarketplacePricesJob(): Promise<void> {
  const cardTraderToken = process.env.CARDTRADER_API_TOKEN;
  if (cardTraderToken) {
    const result = await syncMarketplacePrices(
      new CardTraderAdapter(cardTraderToken),
      "CARDTRADER",
      "CARDTRADER",
      { gameSlug: "pokemon", limit: 500 },
    );
    console.log(
      `[marketplace-prices] cardtrader: ${result.observationsWritten}/${result.variantsChecked} variants priced`,
    );
  }

  const ebayClientId = process.env.EBAY_CLIENT_ID;
  const ebayClientSecret = process.env.EBAY_CLIENT_SECRET;
  if (ebayClientId && ebayClientSecret) {
    const result = await syncMarketplacePrices(
      new EbayActiveListingsAdapter({ clientId: ebayClientId, clientSecret: ebayClientSecret }),
      "EBAY_ACTIVE",
      "EBAY",
      { gameSlug: "pokemon", limit: 200 }, // one HTTP search per variant — keep this run short
    );
    console.log(
      `[marketplace-prices] ebay: ${result.observationsWritten}/${result.variantsChecked} variants priced`,
    );
  }
}
