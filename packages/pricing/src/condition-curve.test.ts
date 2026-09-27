import { describe, expect, it } from "vitest";
import { derivedValue, DEFAULT_CONDITION_MULTIPLIERS } from "./condition-curve";

describe("derivedValue", () => {
  it("returns the near-mint value unchanged for NEAR_MINT", () => {
    expect(derivedValue(1000, "NEAR_MINT")).toBe(1000);
  });

  it("applies the condition multiplier", () => {
    expect(derivedValue(1000, "LIGHTLY_PLAYED")).toBe(850);
  });

  it("falls back to 1.0 for an unknown condition", () => {
    expect(derivedValue(1000, "UNKNOWN")).toBe(1000);
  });

  it("respects custom multiplier tables", () => {
    const custom = { ...DEFAULT_CONDITION_MULTIPLIERS, DAMAGED: 0.1 };
    expect(derivedValue(1000, "DAMAGED", 1, custom)).toBe(100);
  });
});
