"use client";

import { mediaUrl } from "@tcg-vault/shared/src/media-url";
import { CheckCircle2, CircleAlert, RefreshCw, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SyncEvent } from "../../lib/sync-runner";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";

interface SetProgress {
  code: string;
  name: string;
  total: number;
  done: number;
  failed: number;
  phase: "fetching" | "saving";
}
interface FeedCard {
  key: string;
  name: string;
  number: string;
  imageKey: string | null;
}
interface RunState {
  running: boolean;
  sets: SetProgress[];
  feed: FeedCard[];
  log: string[];
  summary: { ok: boolean; lines: string[] } | null;
  error: string | null;
}

const IDLE: RunState = { running: false, sets: [], feed: [], log: [], summary: null, error: null };

/** Streams /api/sync and turns its events into progress state. */
function useSyncRunner() {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<RunState>(IDLE);

  const start = async (body: { codes?: string[]; refresh?: boolean; game: string }) => {
    setState({ ...IDLE, running: true });
    const apply = (e: SyncEvent) =>
      setState((s) => {
        switch (e.type) {
          case "set": {
            // Sent twice per set: "fetching" (estimated total), then "saving" (exact).
            const known = s.sets.some((p) => p.code === e.code);
            return {
              ...s,
              sets: known
                ? s.sets.map((p) =>
                    p.code === e.code ? { ...p, total: e.total, phase: e.phase } : p,
                  )
                : [
                    ...s.sets,
                    {
                      code: e.code,
                      name: e.name,
                      total: e.total,
                      done: 0,
                      failed: 0,
                      phase: e.phase,
                    },
                  ],
            };
          }
          case "card":
            return {
              ...s,
              sets: s.sets.map((p) =>
                p.code === e.code ? { ...p, done: e.done, failed: p.failed + (e.ok ? 0 : 1) } : p,
              ),
              feed: [
                {
                  key: `${e.code}-${e.done}`,
                  name: e.name,
                  number: e.number,
                  imageKey: e.imageKey,
                },
                ...s.feed,
              ].slice(0, 14),
            };
          case "log":
            return { ...s, log: [...s.log, e.line] };
          case "summary":
            return { ...s, summary: { ok: e.ok, lines: e.lines } };
          case "error":
            return { ...s, error: e.message };
        }
      });
    let summaryOk: boolean | null = null;
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as SyncEvent;
          if (event.type === "summary") summaryOk = event.ok;
          apply(event);
        }
      }
    } catch (err) {
      apply({ type: "error", message: `Lost connection to the sync: ${String(err)}` });
    }
    setState((s) => ({ ...s, running: false }));
    if (summaryOk === true) toast("success", "Sync finished");
    else if (summaryOk === false) toast("error", "Sync finished with problems — see the summary");
    router.refresh();
  };

  return { state, start };
}

export function SyncPanel({
  game,
  synced,
  available,
}: {
  game: string;
  synced: Array<{ code: string; name: string; cards: number; symbolUrl: string | null }>;
  available: Array<{ code: string; name: string; totalCards?: number }>;
}) {
  const { state, start } = useSyncRunner();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const syncedCodes = new Set(synced.map((s) => s.code));
  const needle = filter.trim().toLowerCase();
  const shown = available.filter(
    (s) =>
      !needle || s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle),
  );
  const codes = [
    ...new Set([
      ...picked,
      ...typed
        .split(/[,\s]+/)
        .map((c) => c.trim())
        .filter(Boolean),
    ]),
  ];
  const toggle = (code: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Synced sets ({synced.length})</h2>
            <p className="text-xs text-neutral-500">
              Synced automatically in the background; sets are re-checked every 30 days. Re-sync all
              queues every one of them now.
            </p>
          </div>
          <Button
            onClick={() => start({ refresh: true, game })}
            disabled={state.running || synced.length === 0}
          >
            <RefreshCw className={`h-4 w-4 ${state.running ? "animate-spin" : ""}`} />
            {state.running ? "Queuing…" : "Re-sync all"}
          </Button>
        </div>
        {synced.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2 text-sm">
            {synced.map((s) => (
              <li
                key={s.code}
                className="flex items-center gap-2 rounded-full border bg-surface-2 py-1 pl-2 pr-3"
              >
                {s.symbolUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.symbolUrl} alt="" className="h-4 w-4 object-contain" />
                ) : null}
                {s.name}
                <span className="text-xs text-neutral-500">{s.cards}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">
            Nothing synced yet — pick some sets below.
          </p>
        )}
      </section>

      {state.running || state.summary || state.error ? <Progress state={state} /> : null}

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Add sets</h2>
        {available.length > 0 ? (
          <>
            <label className="relative mt-3 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                className="field w-full pl-8"
                placeholder="Filter sets (e.g. 151, Shrouded, sv06)…"
                autoComplete="off"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <ul className="mt-3 max-h-80 overflow-auto rounded-lg border text-sm">
              {shown.map((s) => (
                <li key={s.code} className="border-b last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={picked.has(s.code)}
                      onChange={() => toggle(s.code)}
                      className="accent-[rgb(var(--accent))]"
                    />
                    <span className="flex-1">{s.name}</span>
                    <span className="font-mono text-xs text-neutral-400">{s.code}</span>
                    {s.totalCards ? (
                      <span className="w-16 text-right text-xs text-neutral-400">
                        {s.totalCards} cards
                      </span>
                    ) : null}
                    {syncedCodes.has(s.code) ? (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">synced</span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <label className="label mt-4">
          {available.length > 0 ? "…or type set codes" : "Set codes (comma separated)"}
          <input
            className="field font-mono"
            placeholder="sv06.5, sv03.5"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={() => start({ codes, game })}
            disabled={state.running || codes.length === 0}
          >
            {state.running
              ? "Syncing…"
              : `Sync ${codes.length || ""} selected set${codes.length === 1 ? "" : "s"}`}
          </Button>
          {codes.length > 0 ? (
            <span className="text-xs text-neutral-500">{codes.join(", ")}</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Progress({ state }: { state: RunState }) {
  const total = state.sets.reduce((s, p) => s + p.total, 0);
  const done = state.sets.reduce((s, p) => s + p.done, 0);
  return (
    <section className="panel p-5" aria-live="polite">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {state.running
            ? "Syncing…"
            : state.summary?.ok
              ? "Sync finished"
              : "Sync finished with problems"}
        </h2>
        {total > 0 ? (
          <span className="text-xs tabular-nums text-neutral-500">
            {done} / {total} cards
          </span>
        ) : null}
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {state.sets.map((p) => {
          const pct = p.total ? (p.done / p.total) * 100 : 0;
          return (
            <li key={p.code}>
              <div className="flex justify-between text-xs">
                <span>
                  <span className="font-medium text-neutral-800">{p.name}</span>
                  <span className="ml-2 text-neutral-500">
                    {p.phase === "fetching"
                      ? "Fetching card data…"
                      : p.done < p.total
                        ? "Saving cards…"
                        : "Done"}
                  </span>
                </span>
                <span className="tabular-nums text-neutral-500">
                  {p.done} / {p.total}
                  {p.failed ? ` · ${p.failed} failed` : ""}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  // Explicit start: without it the block fills 100% until first animated.
                  initial={{ width: "0%" }}
                  animate={{ width: `${pct}%` }}
                  transition={{ ease: "easeOut", duration: 0.3 }}
                />
              </div>
            </li>
          );
        })}
        {state.running && state.sets.length === 0 ? (
          <li className="text-xs text-neutral-500">Contacting TCGdex…</li>
        ) : null}
      </ul>

      {state.feed.length > 0 ? (
        <ul className="mt-5 flex gap-2 overflow-hidden" aria-label="Recently synced cards">
          <AnimatePresence initial={false}>
            {state.feed.map((c) => (
              <motion.li
                key={c.key}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="w-16 shrink-0"
                title={`${c.name} · ${c.number}`}
              >
                {c.imageKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(c.imageKey)}
                    alt={c.name}
                    className="aspect-[5/7] w-full rounded object-cover shadow"
                  />
                ) : (
                  <div className="grid aspect-[5/7] w-full place-items-center rounded border-2 border-amber-200 bg-surface-2 p-1 text-center text-[8px] leading-tight text-neutral-500 dark:border-amber-900">
                    {c.name}
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      {state.error ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </p>
      ) : null}
      {state.summary ? (
        <details className="mt-4" open={!state.summary.ok}>
          <summary
            className={`flex cursor-pointer items-center gap-2 text-sm ${
              state.summary.ok
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-700 dark:text-red-300"
            }`}
          >
            {state.summary.ok ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <CircleAlert className="h-4 w-4" />
            )}
            Summary
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs">
            {[...state.log, "", ...state.summary.lines].join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
