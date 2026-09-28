"use client";

import {
  DEFAULT_CONDITION_MULTIPLIERS,
  derivedValue,
} from "@tcg-vault/pricing/src/condition-curve";
import { convertMinor, formatMoney, type FxRates } from "@tcg-vault/shared/src/currency";
import { CONDITIONS, PRICE_KIND_LABELS } from "@tcg-vault/shared/src/enums";
import { useState } from "react";
import type { SerializedPoint } from "../../lib/card-prices";

const CONDITION_LABELS: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near mint",
  LIGHTLY_PLAYED: "Lightly played",
  MODERATELY_PLAYED: "Moderately played",
  HEAVILY_PLAYED: "Heavily played",
  DAMAGED: "Damaged",
};

/**
 * "What would it be worth in this condition?" Each provider's near-mint (or
 * unsplit) headline scaled by the condition curve in @tcg-vault/pricing —
 * clearly an estimate. Where a provider actually lists that condition
 * (CardTrader), its real price is shown next to it.
 */
export function ConditionEstimate({
  rows,
  displayCurrency,
  rates,
}: {
  rows: Array<{ label: string; headline: SerializedPoint; actual: SerializedPoint[] }>;
  displayCurrency: string;
  rates: FxRates;
}) {
  const [condition, setCondition] = useState<string>("LIGHTLY_PLAYED");
  const base = rows.filter(
    (r) => r.headline.condition === null || r.headline.condition === "NEAR_MINT",
  );
  if (base.length === 0) return null;
  const pct = Math.round((DEFAULT_CONDITION_MULTIPLIERS[condition] ?? 1) * 100);
  const show = (amount: number, currency: string) => {
    const converted = convertMinor(amount, currency, displayCurrency, rates);
    return converted === null
      ? formatMoney({ amount, currency })
      : `${currency !== displayCurrency ? "≈" : ""}${formatMoney({ amount: converted, currency: displayCurrency })}`;
  };

  return (
    <div className="mt-4 border-t pt-4">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Condition</span>
        <select
          className="field py-1 text-sm"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABELS[c] ?? c}
            </option>
          ))}
        </select>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Estimate · {pct}% of near mint
        </span>
      </label>
      <ul className="mt-2 grid max-w-md gap-1 text-sm">
        {base.map((r) => {
          const actual = r.actual.find((a) => a.condition === condition);
          return (
            <li key={r.label} className="flex justify-between gap-2">
              <span className="text-neutral-600">
                {r.label}{" "}
                <span className="text-xs text-neutral-400">
                  ({PRICE_KIND_LABELS[r.headline.kind]})
                </span>
              </span>
              <span className="tabular-nums">
                {show(derivedValue(r.headline.amount, condition), r.headline.currency)}
                {actual ? (
                  <span className="ml-2 text-xs text-neutral-500">
                    listed {show(actual.amount, actual.currency)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-neutral-400">
        Estimates apply a fixed condition curve to the near-mint price; real prices for played
        copies vary a lot.
      </p>
    </div>
  );
}
