"use client";

import { configureMoney, type MoneyDisplay } from "./money";

/**
 * Applies the display currency to formatEur() in the browser. Rendered first
 * in the root layout, so every client component after it formats with it.
 */
export function MoneyConfig({ display }: { display: MoneyDisplay }) {
  configureMoney(display);
  return null;
}
