"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setMappingAction } from "../../app/[game]/[set]/[number]/actions";
import { useToast } from "../ui/toast";

/** "Wrong match?" — set the provider's id (or eBay search) by hand, or reset to automatic. */
export function MappingForm({
  variantId,
  provider,
  game,
  externalId,
  query,
  manual,
}: {
  variantId: string;
  provider: string;
  game: string;
  externalId: string | null;
  query: string | null;
  manual: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [id, setId] = useState(externalId ?? "");
  const [q, setQ] = useState(query ?? "");
  const searchBased = provider === "ebay";

  const save = (reset: boolean) =>
    start(async () => {
      const result = await setMappingAction({
        variantId,
        provider,
        game,
        externalId: reset ? "" : searchBased ? "" : id,
        query: reset ? "" : searchBased ? q : "",
      });
      if (result.ok) {
        toast("success", reset ? "Back to automatic matching" : "Match saved — refreshing prices");
        router.refresh();
      } else toast("error", result.error ?? "Couldn't save");
    });

  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">
        {manual ? "Matched by hand — change" : "Wrong match?"}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500">
            {searchBased
              ? "eBay search (listings are still filtered for lots, graded, language…)"
              : provider === "cardtrader"
                ? "CardTrader blueprint id (the number in the card's CardTrader URL)"
                : "Product id"}
          </span>
          <input
            className="field py-1 text-xs"
            value={searchBased ? q : id}
            onChange={(e) => (searchBased ? setQ(e.target.value) : setId(e.target.value))}
          />
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(false)}
            className="font-medium text-accent hover:underline disabled:opacity-50"
          >
            Save
          </button>
          {manual ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(true)}
              className="text-neutral-500 hover:underline disabled:opacity-50"
            >
              Reset to automatic
            </button>
          ) : null}
        </div>
      </div>
    </details>
  );
}
