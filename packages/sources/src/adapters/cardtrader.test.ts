import { describe, expect, it } from "vitest";
import { versionMatches } from "./cardtrader";

describe("versionMatches", () => {
  it("matches reverse holo only to a version mentioning reverse", () => {
    expect(versionMatches("REVERSE_HOLO", "Reverse Holo")).toBe(true);
    expect(versionMatches("REVERSE_HOLO", "Holo")).toBe(false);
  });

  it("matches plain holo but not reverse holo", () => {
    expect(versionMatches("HOLO", "Holo")).toBe(true);
    expect(versionMatches("HOLO", "Reverse Holo")).toBe(false);
  });

  it("treats a null/blank version as non-foil", () => {
    expect(versionMatches("NON_FOIL", null)).toBe(true);
    expect(versionMatches("NON_FOIL", "")).toBe(true);
    expect(versionMatches("NON_FOIL", "Holo")).toBe(false);
  });
});
