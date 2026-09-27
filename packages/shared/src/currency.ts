/** All money in this codebase is integer minor units (cents) + an ISO currency code. */
export type MinorUnits = number;

export interface Money {
  amount: MinorUnits;
  currency: string;
}

export function formatMoney({ amount, currency }: Money, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
}

/**
 * Fixed EUR->USD rate, used only to put Cardmarket (EUR) and TCGplayer (USD)
 * prices on one scale before combining them, and to show a USD figure next
 * to EUR valuations. Approximate on purpose: this app has no FX feed, and a
 * few percent of drift doesn't matter for "what's my binder worth".
 */
export const USD_PER_EUR = 1.1;

/** Converts minor units between EUR and USD with {@link USD_PER_EUR}. Other currencies pass through unchanged. */
export function toEur(amount: MinorUnits, currency: string): MinorUnits {
  return currency === "USD" ? Math.round(amount / USD_PER_EUR) : amount;
}

export function toUsd(amount: MinorUnits, currency: string): MinorUnits {
  return currency === "EUR" ? Math.round(amount * USD_PER_EUR) : amount;
}
