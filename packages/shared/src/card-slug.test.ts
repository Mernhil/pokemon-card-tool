import { describe, expect, it } from "vitest";
import { cardSlug, collectorNumberCandidates } from "./card-slug";

describe("cardSlug", () => {
  it("keeps the total so 002/30 and 002/128 get different URLs", () => {
    expect(cardSlug("002/30")).toBe("002-30");
    expect(cardSlug("002/128")).toBe("002-128");
    expect(cardSlug("TG01")).toBe("TG01");
  });

  it("round-trips through collectorNumberCandidates", () => {
    expect(collectorNumberCandidates(cardSlug("002/30"))).toContain("002/30");
    expect(collectorNumberCandidates("TG01")).toEqual(["TG01"]);
  });
});
