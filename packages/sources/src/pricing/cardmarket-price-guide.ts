import type { PricedCard, ProviderObservation, ResolvedMapping } from "./types";

/**
 * STUB — not wired into the app. Documents the alternative Cardmarket route
 * in case the TCGdex-relayed numbers (tcgdex-prices.ts) ever go away.
 *
 * Cardmarket's API is closed to new applications (help.cardmarket.com,
 * "Cardmarket API"), but Cardmarket publishes a daily **price guide** and
 * **product catalogue** as downloadable JSON for every logged-in user
 * (cardmarket.com/en/Pokemon/Data/Price-Guide and .../Data/Product-List).
 * Rows are keyed by Cardmarket `idProduct` and carry avg, low, trend,
 * avg1/avg7/avg30 and their foil ("-holo") counterparts in EUR.
 *
 * To implement:
 * 1. Confirm the download URLs and that automated daily downloads are within
 *    Cardmarket's terms (not verified — the site wasn't reachable from the
 *    environment this was written in).
 * 2. Download both files once a day as a job on the shared runner
 *    (packages/db/src/jobs/runner.ts), one item per file.
 * 3. Map our variants by the `idProduct` TCGdex already gives us
 *    (ProviderMapping.externalId for "cardmarket"), falling back to the
 *    product catalogue's expansion + name + number.
 * 4. Emit the same kinds as the TCGdex route: trend, market_average (avg),
 *    lowest_listing (low); -holo columns for REVERSE_HOLO.
 */
export class CardmarketPriceGuideProvider {
  readonly id = "cardmarket" as const;
  readonly label = "Cardmarket (price guide files)";

  isConfigured(): boolean {
    return false;
  }

  async resolveMapping(_card: PricedCard): Promise<ResolvedMapping | null> {
    return null;
  }

  async fetchPrices(_card: PricedCard, _mapping: ResolvedMapping): Promise<ProviderObservation[]> {
    throw new Error(
      "Cardmarket price guide import is not implemented (see cardmarket-price-guide.ts)",
    );
  }
}
