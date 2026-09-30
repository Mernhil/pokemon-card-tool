"use client";

import {
  computeTotals,
  mostExpensive,
  type CostCard,
  type CostMode,
  type CostTotals,
} from "@tcg-vault/shared/src/cost-summary";
import { useMemo, useState } from "react";
import { useListState } from "../lib/list-state";
import { CardTile } from "./card-tile";
import { formatEur } from "./money";
import { Button } from "./ui/button";

export interface SearchTile {
  id: string;
  href: string;
  imageKey: string | null;
  name: string;
  number: string;
  subtitle: string;
  finishes: string[];
  price: number | null;
  owned: number;
}

interface Selection {
  /** Printing ids the user ticked off. */
  excluded: string[];
  mode: CostMode;
}

const DEFAULT_SELECTION: Selection = { excluded: [], mode: "cheapest" };

/**
 * The search results grid with the cost summary above it. `summary` holds
 * every card of the filtered result (not just the page shown), computed on
 * the server; unticking cards recomputes the same totals here at once. The
 * selection is remembered per search (list-state, scoped by `scope`).
 */
export function SearchResults({
  tiles,
  summary,
  initialTotals,
  scope,
  pokemon,
}: {
  tiles: SearchTile[];
  summary: CostCard[];
  initialTotals: CostTotals;
  scope: string;
  /** Shown when the search matched one Pokémon by Pokédex number. */
  pokemon?: { dexId: number; name: string; textHref: string } | null;
}) {
  const [{ excluded, mode }, setSelection] = useListState(DEFAULT_SELECTION, scope);
  const [topN, setTopN] = useState(5);
  const excludedSet = useMemo(() => new Set(excluded), [excluded]);

  const untouched = excluded.length === 0 && mode === "cheapest";
  const totals = useMemo(
    () => (untouched ? initialTotals : computeTotals(summary, mode, excludedSet)),
    [untouched, initialTotals, summary, mode, excludedSet],
  );

  const toggle = (id: string) =>
    setSelection((s) => ({
      ...s,
      excluded: s.excluded.includes(id) ? s.excluded.filter((x) => x !== id) : [...s.excluded, id],
    }));

  const cards = totals.cards;
  const noPrice = totals.unpriced;

  return (
    <>
      {pokemon ? (
        <p className="mb-3 text-xs text-neutral-500">
          Showing all cards of Pokémon #{pokemon.dexId} {pokemon.name} ·{" "}
          <a href={pokemon.textHref} className="text-accent underline">
            search the text &quot;{pokemon.name}&quot; instead
          </a>
        </p>
      ) : null}

      <section className="panel mb-5 p-4" aria-label="Cost summary">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">Buy one of each</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatEur(totals.total)}{" "}
              <span className="text-sm font-normal text-neutral-500">
                ({totals.counted} {mode === "every" ? "finishes" : "cards"})
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">Still to buy</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatEur(totals.remaining)}{" "}
              <span className="text-sm font-normal text-neutral-500">
                ({totals.remainingCount} {mode === "every" ? "finishes" : "cards"})
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">Owned</p>
            <p className="text-2xl font-semibold tabular-nums">
              {totals.owned}{" "}
              <span className="text-sm font-normal text-neutral-500">of {cards}</span>
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="What to count per card"
            className="ml-auto flex rounded-lg bg-surface-2 p-0.5 text-xs"
          >
            {(
              [
                ["cheapest", "Cheapest finish"],
                ["every", "Every finish"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setSelection((s) => ({ ...s, mode: value }))}
                className={`rounded-md px-3 py-1 font-medium transition-colors ${
                  mode === value
                    ? "bg-surface text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-2 text-xs text-neutral-500">
          Near-mint value in your price language, all {summary.length} results
          {excluded.length > 0 ? ` (${excluded.length} excluded)` : ""}.
          {noPrice > 0
            ? ` ${noPrice} ${mode === "every" ? "finishes have" : "cards have"} no price yet and ${noPrice === 1 ? "isn't" : "aren't"} counted.`
            : ""}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-neutral-600">
            Exclude the top
            <input
              type="number"
              min={1}
              max={Math.max(1, summary.length)}
              value={topN}
              onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))}
              className="field w-16 py-0.5"
              aria-label="How many of the most expensive cards to exclude"
            />
            most expensive
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setSelection((s) => ({
                ...s,
                excluded: [...new Set([...s.excluded, ...mostExpensive(summary, s.mode, topN)])],
              }))
            }
          >
            Exclude
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={excluded.length === 0}
            onClick={() => setSelection((s) => ({ ...s, excluded: [] }))}
          >
            Reset
          </Button>
        </div>
      </section>

      <ul className="stagger grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map((t) => {
          const isExcluded = excludedSet.has(t.id);
          return (
            <li key={t.id} className="relative">
              <CardTile
                href={t.href}
                imageKey={t.imageKey}
                name={t.name}
                number={t.number}
                subtitle={t.subtitle}
                finishes={t.finishes}
                price={t.price}
                owned={t.owned}
                dimmed={isExcluded}
              />
              <label
                className="absolute left-3 top-3 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-black/60 shadow backdrop-blur-sm"
                title={isExcluded ? "Excluded from the totals — click to include" : "Included in the totals"}
              >
                <input
                  type="checkbox"
                  checked={!isExcluded}
                  onChange={() => toggle(t.id)}
                  className="h-4 w-4 accent-[rgb(var(--accent))]"
                  aria-label={`Include ${t.name} ${t.number} in the totals`}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </>
  );
}
