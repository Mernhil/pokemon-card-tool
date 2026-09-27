import { describe, expect, it } from "vitest";
import { PRICING_PACKAGE_VERSION } from "./index";

describe("@tcg-vault/pricing", () => {
  it("is wired up for later sprints' unit tests", () => {
    expect(PRICING_PACKAGE_VERSION).toBe("0.1.0");
  });
});
