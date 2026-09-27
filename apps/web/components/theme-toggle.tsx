"use client";

import { useState } from "react";
import { THEME_COOKIE, type Theme } from "../lib/theme";

const OPTIONS: Array<{ value: Theme; label: string; icon: string }> = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "system", label: "Auto (follow system)", icon: "◐" },
];

/** Light / Dark / Auto. Applies instantly and remembers it in a cookie for a year. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  const choose = (next: Theme) => {
    setTheme(next);
    const html = document.documentElement;
    html.classList.remove("light", "dark");
    if (next !== "system") html.classList.add(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="ml-auto flex rounded-full border p-0.5 text-sm"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => choose(o.value)}
          className={`h-7 w-7 rounded-full leading-none ${
            theme === o.value
              ? "bg-neutral-900 text-neutral-50"
              : "text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
