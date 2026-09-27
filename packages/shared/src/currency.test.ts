import { describe, expect, it } from "vitest";
import { formatMoney } from "./currency";

describe("formatMoney", () => {
  it("formats integer minor units as currency", () => {
    expect(formatMoney({ amount: 1999, currency: "EUR" }, "en-US")).toBe("€19.99");
  });
});
