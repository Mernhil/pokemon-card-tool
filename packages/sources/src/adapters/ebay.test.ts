import { describe, expect, it } from "vitest";
import { queryFor } from "./ebay";
import type { VariantRef } from "../types";

const base: VariantRef = {
  variantId: "v1",
  externalIds: {},
  cardName: "Pikachu",
  setCode: "cel25",
  setName: "Celebrations",
  collectorNumber: "5/25",
  finish: "NON_FOIL",
  languageCode: "en",
};

describe("queryFor", () => {
  it("includes the card name and collector number", () => {
    const q = queryFor(base);
    expect(q).toContain("Pikachu");
    expect(q).toContain("5/25");
  });

  it("adds a reverse holo hint distinct from plain holo", () => {
    expect(queryFor({ ...base, finish: "REVERSE_HOLO" })).toContain("reverse holo");
    expect(queryFor({ ...base, finish: "HOLO" })).toContain("holo");
    expect(queryFor({ ...base, finish: "HOLO" })).not.toContain("reverse holo");
  });

  it("adds no finish hint for a plain non-foil", () => {
    const q = queryFor({ ...base, finish: "NON_FOIL" });
    expect(q.split(/\s+/)).not.toContain("non");
  });
});
