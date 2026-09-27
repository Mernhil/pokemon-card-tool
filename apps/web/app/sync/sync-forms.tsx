"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { refreshPricesAction, syncSetsAction, type SyncState } from "./actions";

function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-50 hover:bg-neutral-700 disabled:cursor-wait disabled:opacity-50"
    >
      {pending ? "Syncing… (this can take a minute)" : children}
    </button>
  );
}

function Result({ state }: { state: SyncState | null }) {
  if (!state) return null;
  return (
    <pre
      className={`mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded border p-3 text-xs ${
        state.ok
          ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/60"
          : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50"
      }`}
    >
      {state.lines.join("\n")}
    </pre>
  );
}

export function RefreshPricesForm({ hasSets }: { hasSets: boolean }) {
  const [state, action] = useFormState(refreshPricesAction, null);
  return (
    <form action={action}>
      <SubmitButton disabled={!hasSets}>Refresh prices for all synced sets</SubmitButton>
      <Result state={state} />
    </form>
  );
}

export function AddSetsForm({
  available,
  synced,
}: {
  available: Array<{ code: string; name: string; totalCards?: number }>;
  synced: string[];
}) {
  const [state, action] = useFormState(syncSetsAction, null);
  const [filter, setFilter] = useState("");
  const syncedSet = new Set(synced);
  const needle = filter.trim().toLowerCase();
  const shown = available.filter(
    (s) =>
      !needle || s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle),
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      {available.length > 0 ? (
        <>
          <input
            type="search"
            placeholder="Filter sets (e.g. 151, Shrouded, sv06)…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          />
          <ul className="max-h-72 overflow-auto rounded border text-sm">
            {shown.map((s) => (
              <li key={s.code} className="border-b last:border-b-0">
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-neutral-50">
                  <input type="checkbox" name="code" value={s.code} />
                  <span className="flex-1">{s.name}</span>
                  <span className="font-mono text-xs text-neutral-400">{s.code}</span>
                  {s.totalCards ? (
                    <span className="w-16 text-right text-xs text-neutral-400">
                      {s.totalCards} cards
                    </span>
                  ) : null}
                  {syncedSet.has(s.code) ? (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">synced</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        {available.length > 0 ? "…or type set codes" : "Set codes (comma separated)"}
        <input
          name="codes"
          placeholder="sv06.5, sv03.5"
          className="rounded border px-2 py-1 font-mono text-sm"
        />
      </label>
      <div>
        <SubmitButton>Sync selected sets</SubmitButton>
      </div>
      <Result state={state} />
    </form>
  );
}
