"use client";

import { Search } from "lucide-react";
import { useMemo } from "react";
import { CardTile } from "./card-tile";
import { CustomImageControl } from "./custom-image-control";
import { useListState } from "../lib/list-state";

export interface SetGridCard {
  id: string;
  href: string;
  name: string;
  number: string;
  sortNumber: number;
  rarity: string | null;
  imageKey: string | null;
  finishes: string[];
  /** Lowest price across the card's finishes (EUR minor), if any. */
  price: number | null;
  multiPrice: boolean;
  owned: number;
  /** Subset inside the set ("Special Art"), null when it has none. */
  subset: string | null;
}

type Show = "all" | "owned" | "missing";
type Sort = "number" | "price" | "name" | "rarity";

/** Card grid for one set with search, owned/missing filter, sort and "dim missing". */
interface SetGridFilters {
  query: string;
  show: Show;
  sort: Sort;
  dim: boolean;
  /** Selected subset tab; "" is "See all". Remembered with the other filters. */
  subset: string;
}

const DEFAULT_FILTERS: SetGridFilters = {
  query: "",
  show: "all",
  sort: "number",
  dim: true,
  subset: "",
};

export function SetGrid({ cards, subsets = [] }: { cards: SetGridCard[]; subsets?: string[] }) {
  const [{ query, show, sort, dim, subset: rememberedSubset }, setFilters] =
    useListState(DEFAULT_FILTERS);
  // Tabs: only subsets that have cards, in the set's own order.
  const tabs = useMemo(
    () =>
      subsets
        .map((name) => {
          const inSubset = cards.filter((c) => c.subset === name);
          return {
            name,
            total: inSubset.length,
            owned: inSubset.filter((c) => c.owned > 0).length,
          };
        })
        .filter((t) => t.total > 0),
    [cards, subsets],
  );
  // A remembered tab that no longer exists falls back to "See all".
  const subset = tabs.some((t) => t.name === rememberedSubset) ? rememberedSubset : "";
  const setSubset = (subset: string) => setFilters((f) => ({ ...f, subset }));
  const setQuery = (query: string) => setFilters((f) => ({ ...f, query }));
  const setShow = (show: Show) => setFilters((f) => ({ ...f, show }));
  const setSort = (sort: Sort) => setFilters((f) => ({ ...f, sort }));
  const setDim = (dim: boolean) => setFilters((f) => ({ ...f, dim }));
  const anyOwned = cards.some((c) => c.owned > 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = cards.filter(
      (c) =>
        (!subset || c.subset === subset) &&
        (!q || c.name.toLowerCase().includes(q) || c.number.toLowerCase().includes(q)) &&
        (show === "all" || (show === "owned" ? c.owned > 0 : c.owned === 0)),
    );
    const by: Record<Sort, (a: SetGridCard, b: SetGridCard) => number> = {
      number: (a, b) => a.sortNumber - b.sortNumber || a.number.localeCompare(b.number),
      price: (a, b) => (b.price ?? -1) - (a.price ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
      rarity: (a, b) =>
        (a.rarity ?? "").localeCompare(b.rarity ?? "") || a.sortNumber - b.sortNumber,
    };
    return [...list].sort(by[sort]);
  }, [cards, query, show, sort, subset]);

  const seg = (value: Show, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={show === value}
      onClick={() => setShow(value)}
      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
        show === value
          ? "bg-surface text-neutral-900 shadow-sm"
          : "text-neutral-500 hover:text-neutral-900"
      }`}
    >
      {label}
    </button>
  );

  const chip = (value: string, label: string, owned: number, total: number) => (
    <button
      key={value || "all"}
      type="button"
      role="tab"
      aria-selected={subset === value}
      onClick={() => setSubset(value)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        subset === value
          ? "border-accent bg-accent-soft text-neutral-900"
          : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
      }`}
    >
      {label}{" "}
      <span className="tabular-nums text-neutral-500">
        {total}
        {anyOwned ? ` · ${owned}/${total}` : ""}
      </span>
    </button>
  );

  return (
    <>
      {tabs.length > 0 ? (
        <div role="tablist" aria-label="Subsets" className="mb-3 flex flex-wrap gap-2">
          {chip("", "See all", cards.filter((c) => c.owned > 0).length, cards.length)}
          {tabs.map((t) => chip(t.name, t.name, t.owned, t.total))}
        </div>
      ) : null}
      <div className="panel sticky top-3 z-20 mb-5 flex flex-wrap items-center gap-3 p-3">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            className="field w-full pl-8"
            placeholder="Filter this set…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter this set"
          />
        </label>
        <div role="radiogroup" aria-label="Show" className="flex rounded-lg bg-surface-2 p-0.5">
          {seg("all", "All")}
          {seg("owned", "Owned")}
          {seg("missing", "Missing")}
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Sort
          <select
            className="field py-1"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="number">Number</option>
            <option value="price">Price (high → low)</option>
            <option value="name">Name</option>
            <option value="rarity">Rarity</option>
          </select>
        </label>
        {anyOwned ? (
          <label className="flex items-center gap-1.5 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={dim}
              onChange={(e) => setDim(e.target.checked)}
              className="accent-[rgb(var(--accent))]"
            />
            Dim missing
          </label>
        ) : null}
        <span className="ml-auto text-xs tabular-nums text-neutral-500">
          {shown.length} of {cards.length}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">No cards match.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {shown.map((c) => (
            <li key={c.id}>
              <CardTile
                href={c.href}
                imageKey={c.imageKey}
                name={c.name}
                number={c.number}
                subtitle={`${c.number}${c.rarity ? ` · ${c.rarity}` : ""}`}
                finishes={c.finishes}
                price={c.price}
                pricePrefix={c.multiPrice ? "from " : ""}
                owned={c.owned}
                dimmed={dim && anyOwned && c.owned === 0}
                imageAction={<CustomImageControl printingId={c.id} compact />}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
