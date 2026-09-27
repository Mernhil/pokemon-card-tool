/**
 * Binder choices shared by the server and the browser (no Prisma import, so
 * client components can use it: import from "@tcg-vault/db/src/binder-options").
 */
export const BINDER_LAYOUTS = [
  { rows: 2, cols: 2, label: "4-pocket (2×2)" },
  { rows: 3, cols: 3, label: "9-pocket (3×3)" },
  { rows: 4, cols: 3, label: "12-pocket (4×3)" },
] as const;

/** Cover "leather" colours offered in the UI. */
export const BINDER_COLORS = [
  "#5b1f2b", // oxblood
  "#1f3a5f", // navy
  "#1f4d3a", // forest
  "#2a2a2e", // graphite
  "#5a3b1f", // tan
  "#4a2a5e", // plum
  "#7a5a14", // gold
  "#8a2f2f", // crimson
] as const;
