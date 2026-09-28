"use client";

import { HISTORY_RANGES, shapeHistory, type HistoryRange } from "@tcg-vault/pricing/src/history";
import { formatMoney, type FxRates } from "@tcg-vault/shared/src/currency";
import { PRICE_KIND_LABELS } from "@tcg-vault/shared/src/enums";
import { useMemo, useState } from "react";
import type { SerializedPoint } from "../../lib/card-prices";
import { LineChart } from "../ui/line-chart";

/**
 * Price history, one line per provider (its headline kind throughout), in
 * the display currency. Long gaps break the line; a single point is a dot;
 * providers whose currency has no exchange rate are listed, not guessed.
 */
export function PriceHistory({
  points,
  providers,
  displayCurrency,
  rates,
  cardName,
}: {
  points: SerializedPoint[];
  providers: Array<{ id: string; label: string; color: string }>;
  displayCurrency: string;
  rates: FxRates;
  cardName: string;
}) {
  const [range, setRange] = useState<HistoryRange>("90d");
  const shaped = useMemo(
    () =>
      shapeHistory(
        points.map((p) => ({ ...p, observedAt: new Date(p.t) })),
        { providers: providers.map((p) => p.id), range, displayCurrency, rates },
      ),
    [points, providers, range, displayCurrency, rates],
  );
  const labelOf = (id: string) => providers.find((p) => p.id === id)?.label ?? id;
  const series = shaped.series.map((s) => ({
    id: s.provider,
    label: `${labelOf(s.provider)} · ${PRICE_KIND_LABELS[s.kind]}${s.converted ? " (converted)" : ""}`,
    shortLabel: labelOf(s.provider).replace(/ \(via TCGdex\)$/, ""),
    color: providers.find((p) => p.id === s.provider)?.color ?? "var(--series-1)",
    points: s.points,
  }));
  const format = (minor: number) =>
    formatMoney({ amount: Math.round(minor), currency: displayCurrency });

  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Price history</h2>
        <div role="group" aria-label="Time range" className="flex rounded-lg border p-0.5 text-xs">
          {HISTORY_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-md px-2.5 py-1 ${range === r ? "bg-accent-soft font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-900"}`}
            >
              {r === "all" ? "All" : r}
            </button>
          ))}
        </div>
      </div>
      {series.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          {points.length === 0
            ? "No price history yet — it fills in each time prices are refreshed (about daily)."
            : "No prices in this time range."}
        </p>
      ) : (
        <LineChart series={series} label={`${cardName} prices over time`} format={format} />
      )}
      <p className="mt-2 text-xs text-neutral-400">
        One point per day per provider (its latest that day). Lines break where there&apos;s no data
        for a while.
        {shaped.approximate
          ? ` Converted to ${displayCurrency} at ${rates.source === "ecb" ? `ECB rates of ${rates.asOf}` : "built-in approximate rates"} — approximate.`
          : ""}
        {shaped.unconvertible.length
          ? ` Not shown (no ${displayCurrency} rate): ${shaped.unconvertible.map((u) => `${labelOf(u.provider)} (${u.currency})`).join(", ")}.`
          : ""}
      </p>
    </section>
  );
}
