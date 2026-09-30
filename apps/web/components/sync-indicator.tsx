"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getSyncStatusAction,
  retryFailedSetsAction,
  type CatalogStatus,
} from "../app/sync/actions";

/** Polls the background catalog sync: often while it runs, rarely otherwise. */
export function useSyncStatus(): {
  status: CatalogStatus[] | null;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<CatalogStatus[] | null>(null);

  const refresh = async () => {
    try {
      setStatus(await getSyncStatusAction());
    } catch {
      // Server busy/restarting: keep showing the last known state.
    }
  };

  const running = status?.some((s) => s.running) ?? false;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (!cancelled) timer = setTimeout(tick, running ? 3_000 : 30_000);
    };
    timer = setTimeout(tick, status === null ? 0 : running ? 3_000 : 30_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return { status, refresh };
}

export function totals(status: CatalogStatus[]) {
  return status.reduce(
    (t, s) => ({
      total: t.total + s.total,
      done: t.done + s.done,
      failed: t.failed + s.failed,
      unavailable: t.unavailable + s.unavailableSets.length,
      running: t.running || s.running,
      current: [...t.current, ...s.current],
    }),
    { total: 0, done: 0, failed: 0, unavailable: 0, running: false, current: [] as string[] },
  );
}

/**
 * Small, quiet sidebar line: "Syncing catalog 42/170" with a thin bar while
 * the background sync runs, a "N sets failed · Retry" link when some failed,
 * nothing at all once everything is synced.
 */
export function SyncIndicator({ collapsed }: { collapsed: boolean }) {
  const { status, refresh } = useSyncStatus();
  const [retrying, setRetrying] = useState(false);
  if (!status) return null;
  const t = totals(status);
  const failedNames = status
    .flatMap((s) => s.failures)
    .map((f) => `${f.name ?? f.code} — ${f.message}`)
    .join("; ");
  if (t.total === 0 && !t.running) return null;
  if (!t.running && t.failed === 0 && t.done === t.total) return null;

  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
  const title = t.running
    ? `Syncing the card catalog in the background: ${t.done} of ${t.total} sets${t.current.length ? ` — now ${t.current.join(", ")}` : ""}`
    : `${t.failed} set${t.failed === 1 ? "" : "s"} couldn't be synced (they're retried automatically): ${failedNames}`;

  if (collapsed) {
    return (
      <Link
        href="/sync"
        title={title}
        className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-lg text-neutral-500 hover:bg-surface-2"
      >
        {t.running ? (
          <RefreshCw className="h-4 w-4 animate-spin text-accent" />
        ) : (
          <CircleAlert className="h-4 w-4 text-amber-600" />
        )}
      </Link>
    );
  }

  const retry = async () => {
    setRetrying(true);
    try {
      await retryFailedSetsAction();
      await refresh();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className="mx-3 mb-2 rounded-lg px-2 py-2 text-[11px] text-neutral-500"
      title={title}
      aria-live="polite"
    >
      {t.running ? (
        <>
          <Link
            href="/sync"
            className="flex items-center justify-between gap-2 hover:text-neutral-800"
          >
            <span className="flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3 animate-spin text-accent" />
              Syncing catalog
            </span>
            <span className="tabular-nums">
              {t.done}/{t.total}
            </span>
          </Link>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          {t.current.length ? <p className="mt-1 truncate">{t.current.join(", ")}</p> : null}
        </>
      ) : null}
      {t.failed > 0 ? (
        <p className={`flex items-center justify-between gap-2 ${t.running ? "mt-1.5" : ""}`}>
          <Link
            href="/sync"
            className="flex items-center gap-1.5 text-amber-700 hover:underline dark:text-amber-300"
          >
            <CircleAlert className="h-3 w-3" />
            {t.failed} set{t.failed === 1 ? "" : "s"} failed
          </Link>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="font-medium text-accent hover:underline disabled:opacity-50"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </p>
      ) : null}
    </div>
  );
}
