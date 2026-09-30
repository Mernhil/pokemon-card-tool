"use client";

import { PRICE_LANGUAGES } from "@tcg-vault/shared/src/enums";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Which listing language the price panels show. The default is the "Price
 * language" setting; picking another one reloads the card page with `?lang=`
 * (the server queues an on-demand lookup when that language has no data yet).
 */
export function PriceLanguageSelect({
  language,
  defaultLanguage,
}: {
  language: string;
  defaultLanguage: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      Language
      <select
        className="field py-1 text-xs"
        value={language}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value === defaultLanguage) next.delete("lang");
          else next.set("lang", e.target.value);
          const qs = next.toString();
          router.push(qs ? `?${qs}` : "?", { scroll: false });
        }}
        aria-label="Price language"
      >
        {PRICE_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
            {l.code === defaultLanguage ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
