import { describe, expect, it } from "vitest";
import { canonicalKeyFor } from "./canonical-key";

describe("canonicalKeyFor", () => {
  it("is stable across case and whitespace variants", () => {
    const a = canonicalKeyFor("Charizard", "Deals 30 damage.");
    const b = canonicalKeyFor("  charizard  ", "deals   30    damage.");
    const c = canonicalKeyFor("CHARIZARD", "DEALS 30 DAMAGE.");

    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("defaults rulesText to an empty string when omitted", () => {
    expect(canonicalKeyFor("Charizard")).toBe(canonicalKeyFor("Charizard", ""));
    expect(canonicalKeyFor("Charizard")).toBe(canonicalKeyFor("Charizard", "   "));
  });

  it("produces different keys for different names or rules text", () => {
    const base = canonicalKeyFor("Charizard", "Deals 30 damage.");

    expect(canonicalKeyFor("Blastoise", "Deals 30 damage.")).not.toBe(base);
    expect(canonicalKeyFor("Charizard", "Deals 60 damage.")).not.toBe(base);
  });

  it("returns a 40-character hex sha1 digest", () => {
    expect(canonicalKeyFor("Pikachu")).toMatch(/^[0-9a-f]{40}$/);
  });
});
