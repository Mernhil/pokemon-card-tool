import { describe, expect, it } from "vitest";
import { FOIL_PRESETS } from "./presets";

describe("FOIL_PRESETS", () => {
  it("has a non-foil baseline with zero intensity", () => {
    expect(FOIL_PRESETS["non-foil"]?.params.intensity).toBe(0);
  });

  it("gives every foil finish some visual effect: sheen or embossed relief", () => {
    const foilFinishes = Object.values(FOIL_PRESETS).filter((p) => p.slug !== "non-foil");
    for (const preset of foilFinishes) {
      expect(preset.params.intensity + preset.params.reliefStrength).toBeGreaterThan(0);
    }
  });
});
