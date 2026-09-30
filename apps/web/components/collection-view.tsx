"use client";

import { CONDITIONS } from "@tcg-vault/shared/src/enums";
import { LayoutGrid, List, Minus, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteCollectionItemAction, updateCollectionItemAction } from "../app/actions";
import { CardImage } from "./card-image";
import { CardTile } from "./card-tile";
import { FinishBadge, finishLabel, formatEur } from "./money";
import { useToast } from "./ui/toast";
import { COLLECTION_VIEW_COOKIE } from "../lib/ui-cookies";
import { useListState } from "../lib/list-state";

export interface CollectionRow {
  id: string;
  href: string;
  name: string;
  number: string;
  setName: string;
  imageKey: string | null;
  finish: string;
  rarity: string | null;
  quantity: number;
  condition: string | null;
  graded: string | null;
  /** Value of the whole entry (quantity × condition-adjusted NM), EUR minor. */
  value: number | null;
  paidPerCard: number | null;
  addedAt: number;
}

const CONDITION_SHORT: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "NM",
  LIGHTLY_PLAYED: "LP",
  MODERATELY_PLAYED: "MP",
  HEAVILY_PLAYED: "HP",
  DAMAGED: "DMG",
};

type Sort = "value" | "recent" | "name" | "set";

interface CollectionFilters {
  query: string;
  setFilter: string;
  finish: string;
  sort: Sort;
}

const DEFAULT_FILTERS: CollectionFilters = { query: "", setFilter: "", finish: "", sort: "value" };

export function CollectionView({
  rows,
  initialView,
}: {
  rows: CollectionRow[];
  initialView: "grid" | "list";
}) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const [view, setView] = useState(initialView);
  const [{ query, setFilter, finish, sort }, setFilters] = useListState(DEFAULT_FILTERS);
  const setQuery = (query: string) => setFilters((f) => ({ ...f, query }));
  const setSetFilter = (setFilter: string) => setFilters((f) => ({ ...f, setFilter }));
  const setFinish = (finish: string) => setFilters((f) => ({ ...f, finish }));
  const setSort = (sort: Sort) => setFilters((f) => ({ ...f, sort }));
  const [local, setLocal] = useState<Record<string, Partial<CollectionRow> | null>>({});

  const sets = useMemo(() => [...new Set(rows.map((r) => r.setName))].sort(), [rows]);
  const finishes = useMemo(() => [...new Set(rows.map((r) => r.finish))], [rows]);

  const merged = rows
    .filter((r) => local[r.id] !== null)
    .map((r) => ({ ...r, ...(local[r.id] ?? {}) }));
  const q = query.trim().toLowerCase();
  const shown = merged
    .filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q) || r.number.toLowerCase().includes(q)) &&
        (!setFilter || r.setName === setFilter) &&
        (!finish || r.finish === finish),
    )
    .sort(
      {
        value: (a: CollectionRow, b: CollectionRow) => (b.value ?? -1) - (a.value ?? -1),
        recent: (a: CollectionRow, b: CollectionRow) => b.addedAt - a.addedAt,
        name: (a: CollectionRow, b: CollectionRow) => a.name.localeCompare(b.name),
        set: (a: CollectionRow, b: CollectionRow) =>
          a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number),
      }[sort],
    );

  const changeView = (v: "grid" | "list") => {
    setView(v);
    document.cookie = `${COLLECTION_VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  };

  const update = (row: CollectionRow, data: { quantity?: number; condition?: string | null }) => {
    if (data.quantity !== undefined && data.quantity <= 0) return remove(row);
    const perCard = row.value !== null ? row.value / row.quantity : null;
    setLocal((l) => ({
      ...l,
      [row.id]: {
        ...(l[row.id] ?? {}),
        ...data,
        ...(data.quantity !== undefined && perCard !== null
          ? { value: Math.round(perCard * data.quantity) }
          : {}),
      },
    }));
    start(async () => {
      const res = await updateCollectionItemAction(row.id, data);
      if (!res.ok) toast("error", res.error);
      router.refresh();
    });
  };

  const remove = (row: CollectionRow) => {
    setLocal((l) => ({ ...l, [row.id]: null }));
    start(async () => {
      const res = await deleteCollectionItemAction(row.id);
      if (!res.ok) toast("error", res.error);
      else toast("success", `Removed ${row.name} from your collection`);
      router.refresh();
    });
  };

  const viewBtn = (v: "grid" | "list", Icon: typeof List, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === v}
      aria-label={label}
      title={label}
      onClick={() => changeView(v)}
      className={`grid h-7 w-8 place-items-center rounded-md ${
        view === v
          ? "bg-surface text-neutral-900 shadow-sm"
          : "text-neutral-500 hover:text-neutral-900"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <>
      <div className="panel sticky top-3 z-20 mb-5 flex flex-wrap items-center gap-3 p-3">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            className="field w-full pl-8"
            placeholder="Filter your cards…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter your cards"
          />
        </label>
        <select
          className="field py-1"
          value={setFilter}
          onChange={(e) => setSetFilter(e.target.value)}
          aria-label="Set"
        >
          <option value="">All sets</option>
          {sets.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="field py-1"
          value={finish}
          onChange={(e) => setFinish(e.target.value)}
          aria-label="Finish"
        >
          <option value="">Any finish</option>
          {finishes.map((f) => (
            <option key={f} value={f}>
              {finishLabel(f)}
            </option>
          ))}
        </select>
        <select
          className="field py-1"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort"
        >
          <option value="value">Highest value</option>
          <option value="recent">Recently added</option>
          <option value="name">Name</option>
          <option value="set">Set & number</option>
        </select>
        <div
          role="radiogroup"
          aria-label="View"
          className="ml-auto flex rounded-lg bg-surface-2 p-0.5"
        >
          {viewBtn("grid", LayoutGrid, "Grid")}
          {viewBtn("list", List, "List")}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">No cards match.</p>
      ) : view === "grid" ? (
        <ul className="stagger grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {shown.map((r) => (
            <li key={r.id}>
              <CardTile
                href={r.href}
                imageKey={r.imageKey}
                name={r.name}
                number={r.number}
                subtitle={`${r.setName} · ${r.graded ?? CONDITION_SHORT[r.condition ?? ""] ?? "—"}`}
                finishes={[r.finish]}
                price={r.value}
                owned={r.quantity}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="panel divide-y">
          {shown.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-4 py-3">
              <Link href={r.href} className="shrink-0">
                <CardImage imageKey={r.imageKey} name={r.name} size="thumb" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={r.href} className="font-medium hover:text-accent">
                  {r.name}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  {r.setName} · {r.number}
                  <FinishBadge finish={r.finish} />
                  {r.paidPerCard !== null ? (
                    <span>paid {formatEur(r.paidPerCard)}/card</span>
                  ) : null}
                </p>
              </div>
              {r.graded ? (
                <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-medium">
                  {r.graded}
                </span>
              ) : (
                <select
                  className="field py-1 text-xs"
                  value={r.condition ?? ""}
                  onChange={(e) => update(r, { condition: e.target.value || null })}
                  aria-label={`Condition of ${r.name}`}
                >
                  <option value="">—</option>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_SHORT[c]}
                    </option>
                  ))}
                </select>
              )}
              <div
                className="flex items-center rounded-lg border"
                aria-label={`Quantity of ${r.name}`}
              >
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center text-neutral-500 hover:text-neutral-900"
                  onClick={() => update(r, { quantity: r.quantity - 1 })}
                  aria-label="One less"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-7 text-center text-sm tabular-nums">{r.quantity}</span>
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center text-neutral-500 hover:text-neutral-900"
                  onClick={() => update(r, { quantity: r.quantity + 1 })}
                  aria-label="One more"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="w-28 text-right tabular-nums">
                <span className="block text-sm font-semibold">
                  {r.value !== null ? formatEur(r.value) : "—"}
                </span>
                <GainLoss
                  value={r.value}
                  paid={r.paidPerCard !== null ? r.paidPerCard * r.quantity : null}
                />
              </span>
              <button
                type="button"
                onClick={() => remove(r)}
                className="rounded-md p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                aria-label={`Remove ${r.name}`}
                title="Remove from collection"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Current value vs. what was paid: "▲ +€3.20 (+36%)", never colour alone. */
function GainLoss({ value, paid }: { value: number | null; paid: number | null }) {
  if (value === null || paid === null || paid <= 0) return null;
  const diff = value - paid;
  const pct = Math.round((diff / paid) * 100);
  const up = diff >= 0;
  return (
    <span
      className={`block text-[11px] ${up ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
      title={`Paid ${formatEur(paid)} in total`}
    >
      {up ? "▲ +" : "▼ −"}
      {formatEur(Math.abs(diff))} ({up ? "+" : "−"}
      {Math.abs(pct)}%)
    </span>
  );
}
