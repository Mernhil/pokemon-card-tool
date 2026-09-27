import type { Config } from "tailwindcss";

/**
 * Dark mode without a `dark:` on every class: the neutral scale is backed by
 * CSS variables (globals.css) that flip in dark mode, so `bg-neutral-100`
 * etc. just work in both. `white`/`black` stay fixed (used where something
 * must look the same in both, e.g. the card inspector's backdrop). Accent
 * colours opt in with `dark:` variants.
 *
 * Theme choice: <html class="dark"> or "light" forces it (set from the
 * `theme` cookie in app/layout.tsx); no class follows the OS setting.
 */
const neutral = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
    step,
    `rgb(var(--neutral-${step}) / <alpha-value>)`,
  ]),
);

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: [
    "variant",
    ["&:is(.dark *)", "@media (prefers-color-scheme: dark) { &:not(.light *):not(.dark *) }"],
  ],
  theme: {
    extend: {
      colors: {
        neutral,
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        sidebar: "rgb(var(--sidebar) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          strong: "rgb(var(--accent-strong) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ['"Cinzel Variable"', "Georgia", "serif"],
      },
      borderColor: {
        DEFAULT: "rgb(var(--neutral-200) / <alpha-value>)",
      },
    },
  },
  plugins: [],
} satisfies Config;
