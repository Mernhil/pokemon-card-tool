"use client";

import { PRICE_LANGUAGES_MAIN_FIRST } from "@tcg-vault/shared/src/enums";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Which listing language the price panels show. The default is the "Price
 * language" setting; picking another one reloads the card page with `?lang=`
 * (the server queues an on-demand lookup when that language has no data yet).
 */
export function PriceLanguageSelect({
  language,
  defaultLanguage,
  canFilter,
  siblings = [],
}: {
  language: string;
  defaultLanguage: string;
  /** False when no configured provider can split by language: the choice would change nothing. */
  canFilter: boolean;
  /** The same card in other languages: choosing one of those opens that card. */
  siblings?: Array<{ language: string; href: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label
      className="flex items-center gap-1.5 text-xs text-neutral-500"
      title={
        canFilter || siblings.length > 0
          ? undefined
          : "Only eBay and CardTrader can split prices by language. Add an API key in Settings."
      }
    >
      Language
      <select
        className="field py-1 text-xs disabled:opacity-50"
        disabled={!canFilter && siblings.length === 0}
        value={language}
        onChange={(e) => {
          const sibling = siblings.find((s) => s.language === e.target.value);
          if (sibling) {
            router.push(sibling.href);
            return;
          }
          const next = new URLSearchParams(params.toString());
          if (e.target.value === defaultLanguage) next.delete("lang");
          else next.set("lang", e.target.value);
          const qs = next.toString();
          router.push(qs ? `?${qs}` : "?", { scroll: false });
        }}
        aria-label="Price language"
      >
        {PRICE_LANGUAGES_MAIN_FIRST.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
            {siblings.some((s) => s.language === l.code) ? " — open card" : ""}
            {l.code === defaultLanguage ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
