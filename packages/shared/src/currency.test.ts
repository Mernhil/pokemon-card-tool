import { describe, expect, it } from "vitest";
import {
  BUILTIN_FX_RATES,
  convertMinor,
  currencyDecimals,
  formatMoney,
  toEur,
  toUsd,
  type FxRates,
} from "./currency";

describe("formatMoney", () => {
  it("formats integer minor units as currency", () => {
    expect(formatMoney({ amount: 1999, currency: "EUR" }, "en-US")).toBe("€19.99");
  });

  it("knows currencies without minor units", () => {
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("EUR")).toBe(2);
    expect(formatMoney({ amount: 1500, currency: "JPY" }, "en-US")).toBe("¥1,500");
  });
});

describe("convertMinor", () => {
  const rates: FxRates = {
    source: "ecb",
    asOf: "2026-09-25",
    perEur: { EUR: 1, USD: 1.2, JPY: 150, GBP: 0.8 },
  };

  it("converts through EUR, respecting each currency's minor units", () => {
    expect(convertMinor(1000, "EUR", "USD", rates)).toBe(1200);
    expect(convertMinor(1200, "USD", "EUR", rates)).toBe(1000);
    expect(convertMinor(1000, "EUR", "JPY", rates)).toBe(1500); // €10 -> ¥1,500 (no cents)
    expect(convertMinor(1500, "JPY", "GBP", rates)).toBe(800); // ¥1,500 -> €10 -> £8.00
  });

  it("is the identity for the same currency, even without rates", () => {
    expect(convertMinor(123, "XYZ", "XYZ", rates)).toBe(123);
  });

  it("returns null instead of guessing for unknown currencies", () => {
    expect(convertMinor(100, "XYZ", "EUR", rates)).toBeNull();
    expect(convertMinor(100, "EUR", "XYZ", rates)).toBeNull();
  });

  it("keeps the legacy helpers working with built-in rates", () => {
    expect(toUsd(1000, "EUR")).toBe(Math.round(1000 * BUILTIN_FX_RATES.perEur.USD!));
    expect(toEur(1100, "USD")).toBe(1000);
    expect(toEur(500, "XYZ")).toBe(500);
  });
});
