"use client";

import { priceLanguageLabel } from "@tcg-vault/shared/src/enums";
import { useState } from "react";
import { changeCollectionLanguageAction, collectionLanguageOptionsAction } from "../app/actions";
import { useToast } from "./ui/toast";

/**
 * The language of a saved copy. The other languages the card exists in are looked up
 * when the menu is first opened; picking one moves the entry to that language's card.
 */
export function CollectionLanguageSelect({
  itemId,
  name,
  language,
  onChanged,
}: {
  itemId: string;
  name: string;
  language: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [options, setOptions] = useState<string[] | null>(null);
  const load = () => {
    if (options === null) void collectionLanguageOptionsAction(itemId).then(setOptions);
  };
  const all = [language, ...(options ?? []).filter((c) => c !== language)];
  return (
    <select
      className="field py-1 text-xs"
      value={language}
      onFocus={load}
      onMouseDown={load}
      onChange={async (e) => {
        const res = await changeCollectionLanguageAction(itemId, e.target.value);
        if (!res.ok) toast("error", res.error);
        else toast("success", `${name} moved to ${priceLanguageLabel(e.target.value)}`);
        onChanged();
      }}
      aria-label={`Language of ${name}`}
      title={options && options.length === 0 ? "This card isn't linked to another language yet" : undefined}
    >
      {all.map((code) => (
        <option key={code} value={code}>
          {priceLanguageLabel(code)}
        </option>
      ))}
    </select>
  );
}
