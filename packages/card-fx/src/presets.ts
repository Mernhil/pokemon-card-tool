/**
 * Finish -> shader preset. FoilProfile.shader (in packages/db) picks one of
 * these; FoilProfile.params overrides the defaults below per print.
 */
export interface FoilPresetParams {
  hueSpread: number;
  intensity: number;
  grainScale: number;
  sparkleDensity: number;
  reliefStrength: number;
}

export interface FoilPreset {
  slug: string;
  pattern: "none" | "linear-rainbow" | "glitter" | "voronoi" | "diagonal" | "sparkle-noise";
  params: FoilPresetParams;
}

const base: FoilPresetParams = {
  hueSpread: 0,
  intensity: 0,
  grainScale: 0,
  sparkleDensity: 0,
  reliefStrength: 0,
};

export const FOIL_PRESETS: Record<string, FoilPreset> = {
  "non-foil": { slug: "non-foil", pattern: "none", params: base },
  holo: {
    slug: "holo",
    pattern: "linear-rainbow",
    params: { ...base, hueSpread: 1, intensity: 0.8 },
  },
  "reverse-holo": {
    slug: "reverse-holo",
    pattern: "glitter",
    params: { ...base, hueSpread: 0.6, intensity: 0.5, grainScale: 1.2 },
  },
  cosmos: {
    slug: "cosmos",
    pattern: "voronoi",
    params: { ...base, hueSpread: 0.9, intensity: 0.7, sparkleDensity: 1 },
  },
  "full-art-textured": {
    slug: "full-art-textured",
    pattern: "sparkle-noise",
    params: { ...base, hueSpread: 0.5, intensity: 0.6, reliefStrength: 0.8 },
  },
  gold: {
    slug: "gold",
    pattern: "sparkle-noise",
    params: { ...base, hueSpread: 0.15, intensity: 0.9, reliefStrength: 1 },
  },
  "ygo-secret": {
    slug: "ygo-secret",
    pattern: "diagonal",
    params: { ...base, hueSpread: 0.8, intensity: 0.7 },
  },
  "ygo-ultimate": {
    slug: "ygo-ultimate",
    pattern: "none",
    params: { ...base, reliefStrength: 1 },
  },
  "op-parallel": {
    slug: "op-parallel",
    pattern: "sparkle-noise",
    params: { ...base, hueSpread: 1, intensity: 0.9, sparkleDensity: 0.8 },
  },
};
