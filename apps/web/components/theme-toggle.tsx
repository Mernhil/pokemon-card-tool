"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { THEME_COOKIE, type Theme } from "../lib/theme";

const OPTIONS: Array<{ value: Theme; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto (follow system)", icon: Monitor },
];

function apply(next: Theme) {
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  if (next !== "system") html.classList.add(next);
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Light / Dark / Auto. Applies instantly and remembers it in a cookie for a
 * year. `compact` (collapsed sidebar) shows one button that cycles.
 */
export function ThemeToggle({ initial, compact = false }: { initial: Theme; compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
  };

  if (compact) {
    const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]!;
    const next = OPTIONS[(OPTIONS.indexOf(current) + 1) % OPTIONS.length]!;
    return (
      <button
        type="button"
        onClick={() => choose(next.value)}
        title={`Theme: ${current.label} — click for ${next.label}`}
        aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
        className="grid h-9 w-9 place-items-center rounded-lg text-neutral-500 hover:bg-surface-2 hover:text-neutral-900"
      >
        <current.icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-surface-2 p-0.5">
      {OPTIONS.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => choose(o.value)}
            className={`grid h-7 flex-1 place-items-center rounded-md transition-colors ${
              active
                ? "bg-surface text-accent shadow-sm"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            <o.icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
