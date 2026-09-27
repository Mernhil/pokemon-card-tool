export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Cookie (not localStorage): the desktop app's port changes every launch, cookies don't care about ports. */
export const THEME_COOKIE = "theme";

export function parseTheme(value: string | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";
}
