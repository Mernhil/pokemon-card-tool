"use client";

import { Search } from "lucide-react";
import { useMemo, useRef } from "react";
import { CardTile } from "./card-tile";
import { useListState } from "../lib/list-state";
import { useQuickAdd } from "../lib/use-quick-add";

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
  /** One per finish: what the tile's quick add/remove controls act on. */
  variants: SetGridVariant[];
}

export interface SetGridVariant {
  id: string;
  finish: string;
  /** All copies of this variant. */
  owned: number;
  /** Ungraded copies (no grading company, no cert). */
  ownedPlain: number;
}

type Show = "all" | "owned" | "missing";
type Sort = "number" | "price" | "name" | "rarity";

/** Card grid for one set with search, owned/missing filter, sort and "dim missing". */
interface SetGridFilters {
  query: string;
  show: Show;
  sort: Sort;
  dim: boolean;
}

const DEFAULT_FILTERS: SetGridFilters = { query: "", show: "all", sort: "number", dim: true };

export function SetGrid({ cards }: { cards: SetGridCard[] }) {
  const [{ query, show, sort, dim }, setFilters] = useListState(DEFAULT_FILTERS);
  const setQuery = (query: string) => setFilters((f) => ({ ...f, query }));
  const setShow = (show: Show) => setFilters((f) => ({ ...f, show }));
  const setSort = (sort: Sort) => setFilters((f) => ({ ...f, sort }));
  const setDim = (dim: boolean) => setFilters((f) => ({ ...f, dim }));

  const variants = useMemo(
    () =>
      cards.flatMap((c) =>
        c.variants.map((v) => ({ variantId: v.id, plain: v.ownedPlain, total: v.owned })),
      ),
    [cards],
  );
  const { counts, adjust } = useQuickAdd(variants);
  const ownedOf = (c: SetGridCard) =>
    c.variants.length === 0
      ? c.owned
      : c.variants.reduce((s, v) => s + (counts[v.id]?.total ?? 0), 0);
  const anyOwned = cards.some((c) => ownedOf(c) > 0);

  // With the Owned / Missing filter on, a card that changes status stays put
  // until a filter changes, so the grid doesn't reshuffle under the cursor.
  // The status is captured per filter combination; cards new to the list use
  // their live status.
  const filterKey = `${query}\u0000${show}\u0000${sort}`;
  const statusSnap = useRef<{ key: string; owned: Map<string, boolean> }>({
    key: filterKey,
    owned: new Map(),
  });
  if (statusSnap.current.key !== filterKey) {
    statusSnap.current = {
      key: filterKey,
      owned: new Map(cards.map((c) => [c.id, ownedOf(c) > 0])),
    };
  }
  const snap = statusSnap.current.owned;
  for (const c of cards) if (!snap.has(c.id)) snap.set(c.id, ownedOf(c) > 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = cards.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.number.toLowerCase().includes(q)) &&
        (show === "all" || (show === "owned" ? snap.get(c.id) : !snap.get(c.id))),
    );
    const by: Record<Sort, (a: SetGridCard, b: SetGridCard) => number> = {
      number: (a, b) => a.sortNumber - b.sortNumber || a.number.localeCompare(b.number),
      price: (a, b) => (b.price ?? -1) - (a.price ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
      rarity: (a, b) =>
        (a.rarity ?? "").localeCompare(b.rarity ?? "") || a.sortNumber - b.sortNumber,
    };
    return [...list].sort(by[sort]);
    // `snap` is stable for a filter combination — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, query, show, sort, filterKey]);

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

  return (
    <>
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
          {shown.map((c) => {
            const owned = ownedOf(c);
            return (
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
                  owned={owned}
                  dimmed={dim && anyOwned && owned === 0}
                  quickAdd={{
                    rows: c.variants.map((v) => ({
                      variantId: v.id,
                      finish: v.finish,
                      plain: counts[v.id]?.plain ?? 0,
                      total: counts[v.id]?.total ?? 0,
                    })),
                    onAdjust: adjust,
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
