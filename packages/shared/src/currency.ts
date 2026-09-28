/**
 * All money in this codebase is integer minor units + an ISO 4217 currency
 * code: cents for EUR/USD/GBP, whole units for currencies without decimals
 * (JPY, KRW). Amounts are stored in the currency they were observed in and
 * only converted for display/aggregation, with the conversion flagged as
 * approximate wherever it's shown.
 */
export type MinorUnits = number;

export interface Money {
  amount: MinorUnits;
  currency: string;
}

const decimalsCache = new Map<string, number>();

/** Minor-unit digits of a currency: 2 for EUR, 0 for JPY. Unknown codes -> 2. */
export function currencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  let digits = decimalsCache.get(code);
  if (digits === undefined) {
    try {
      digits =
        new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions()
          .maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    decimalsCache.set(code, digits);
  }
  return digits;
}

export function formatMoney({ amount, currency }: Money, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amount / 10 ** currencyDecimals(currency),
  );
}

/**
 * Exchange rates as units of each currency per 1 EUR (the ECB's convention).
 * Adding a currency is one entry here; the daily ECB refresh
 * (packages/db/src/fx.ts) then keeps it current along with ~30 others.
 */
export interface FxRates {
  perEur: Record<string, number>;
  /** When the rates were published, if known. */
  asOf: string | null;
  source: "builtin" | "ecb";
}

/**
 * Built-in fallback until the first ECB refresh succeeds (offline first
 * launch). Deliberately rough: anything converted with these is shown as
 * approximate, and the ECB feed replaces them within a day.
 */
export const BUILTIN_FX_RATES: FxRates = {
  source: "builtin",
  asOf: null,
  perEur: {
    EUR: 1,
    USD: 1.1,
    GBP: 0.85,
    JPY: 165,
    CHF: 0.94,
    CAD: 1.5,
    AUD: 1.65,
    NZD: 1.8,
    SEK: 11.3,
    NOK: 11.6,
    DKK: 7.46,
    PLN: 4.28,
    CZK: 25,
    HUF: 395,
    RON: 4.98,
    BGN: 1.9558,
    ISK: 150,
    TRY: 38,
    KRW: 1500,
    CNY: 7.9,
    HKD: 8.6,
    SGD: 1.46,
    BRL: 6.1,
    MXN: 20.5,
    INR: 93,
    ZAR: 20.3,
    THB: 38,
    MYR: 4.9,
    PHP: 63,
    IDR: 17800,
    ILS: 4.1,
  },
};

/** Currencies offered as the display currency: everything we have a rate for. */
export function displayCurrencies(rates: FxRates = BUILTIN_FX_RATES): string[] {
  return Object.keys(rates.perEur).sort((a, b) =>
    a === "EUR" ? -1 : b === "EUR" ? 1 : a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b),
  );
}

/**
 * Converts minor units between any two currencies we have rates for (via
 * EUR). null when either rate is unknown — callers then show the native
 * amount instead of guessing.
 */
export function convertMinor(
  amount: MinorUnits,
  from: string,
  to: string,
  rates: FxRates = BUILTIN_FX_RATES,
): MinorUnits | null {
  const src = from.toUpperCase();
  const dst = to.toUpperCase();
  if (src === dst) return amount;
  const fromRate = rates.perEur[src];
  const toRate = rates.perEur[dst];
  if (!fromRate || !toRate) return null;
  const major = amount / 10 ** currencyDecimals(src);
  return Math.round((major / fromRate) * toRate * 10 ** currencyDecimals(dst));
}

/**
 * Legacy fixed EUR->USD rate. Kept for existing callers; new code uses
 * {@link convertMinor} with the current rates.
 */
export const USD_PER_EUR = BUILTIN_FX_RATES.perEur.USD!;

/** Converts minor units to EUR (built-in rates unless given). Unknown currencies pass through unchanged. */
export function toEur(
  amount: MinorUnits,
  currency: string,
  rates: FxRates = BUILTIN_FX_RATES,
): MinorUnits {
  return convertMinor(amount, currency, "EUR", rates) ?? amount;
}

export function toUsd(
  amount: MinorUnits,
  currency: string,
  rates: FxRates = BUILTIN_FX_RATES,
): MinorUnits {
  return convertMinor(amount, currency, "USD", rates) ?? amount;
}
