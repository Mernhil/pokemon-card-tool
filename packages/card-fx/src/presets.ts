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
  pattern:
    | "none"
    | "linear-rainbow"
    | "glitter"
    | "voronoi"
    | "diagonal"
    | "sparkle-noise"
    | "shards";
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

  // --- One preset per remaining `Finish` (packages/shared/src/enums.ts), so
  // a real finish never has to fall back to a generic/wrong-looking one. ---
  "cracked-ice": {
    slug: "cracked-ice",
    pattern: "shards",
    params: { ...base, hueSpread: 0.5, intensity: 0.75, grainScale: 1.4, sparkleDensity: 0.6 },
  },
  rainbow: {
    slug: "rainbow",
    pattern: "linear-rainbow",
    params: { ...base, hueSpread: 1, intensity: 1, sparkleDensity: 0.3 },
  },
  etched: {
    slug: "etched",
    pattern: "diagonal",
    params: { ...base, hueSpread: 0.35, intensity: 0.55, reliefStrength: 1, grainScale: 1 },
  },
  parallel: {
    slug: "parallel",
    pattern: "diagonal",
    params: { ...base, hueSpread: 0.7, intensity: 0.6, sparkleDensity: 0.2 },
  },
  "secret-textured": {
    slug: "secret-textured",
    pattern: "sparkle-noise",
    params: { ...base, hueSpread: 0.8, intensity: 0.85, reliefStrength: 0.6, sparkleDensity: 1 },
  },
  ultimate: {
    slug: "ultimate",
    pattern: "none",
    params: { ...base, reliefStrength: 1, grainScale: 0.8 },
  },
  ghost: {
    slug: "ghost",
    pattern: "linear-rainbow",
    params: { ...base, hueSpread: 0.25, intensity: 0.35, reliefStrength: 0.3 },
  },
  starlight: {
    slug: "starlight",
    pattern: "voronoi",
    params: { ...base, hueSpread: 0.95, intensity: 0.95, sparkleDensity: 1.2 },
  },
  "quarter-century": {
    slug: "quarter-century",
    pattern: "sparkle-noise",
    params: { ...base, hueSpread: 0.1, intensity: 0.9, reliefStrength: 0.9, sparkleDensity: 0.7 },
  },
  prismatic: {
    slug: "prismatic",
    pattern: "sparkle-noise",
    params: { ...base, hueSpread: 1, intensity: 1, sparkleDensity: 1, reliefStrength: 0.4 },
  },
};
