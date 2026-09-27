/** All money in this codebase is integer minor units (cents) + an ISO currency code. */
export type MinorUnits = number;

export interface Money {
  amount: MinorUnits;
  currency: string;
}

export function formatMoney({ amount, currency }: Money, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
}
