"use client";

import { CheckCircle2, CircleAlert, RefreshCw, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { totals, useSyncStatus } from "../../components/sync-indicator";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";
import { retryFailedSetsAction, syncNowAction, type SetIssue } from "./actions";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

function IssueList({ issues }: { issues: SetIssue[] }) {
  return (
    <ul className="mt-2 max-h-72 space-y-2 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">
      {issues.map((f) => (
        <li key={f.code}>
          <p>
            <span className="font-medium text-neutral-800">{f.name ?? f.code}</span>{" "}
            <span className="font-mono text-neutral-400">{f.code}</span>
          </p>
          <p className="text-neutral-600">{f.message}</p>
          <p className="text-neutral-400">
            {f.attempts} attempt{f.attempts === 1 ? "" : "s"} · last tried {when(f.lastAttemptAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The background catalog sync at a glance: sets done / total, what's syncing, what failed. */
export function CatalogStatusPanel() {
  const { status, refresh } = useSyncStatus();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!status) return <section className="panel h-28 animate-pulse p-5" aria-busy />;

  const t = totals(status);
  const failures = status.flatMap((s) => s.failures);
  const unavailable = status.flatMap((s) => s.unavailableSets);
  const pct = t.total ? (t.done / t.total) * 100 : 0;

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast("success", message);
      await refresh();
      router.refresh();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel p-5" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {t.running ? (
              <RefreshCw className="h-4 w-4 animate-spin text-accent" />
            ) : t.failed === 0 && t.total > 0 && t.done === t.total ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : null}
            Catalog {t.running ? "syncing in the background" : "sync"}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {t.total === 0
              ? "Waiting for the first sync to list the sets (needs an internet connection)."
              : `${t.done} of ${t.total} sets synced${t.failed ? ` · ${t.failed} failed` : ""}. Card data only — images are downloaded when you first look at a card.`}
          </p>
        </div>
        <div className="flex gap-2">
          {t.failed > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => act(() => retryFailedSetsAction(), "Failed sets queued again")}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry failed sets
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || t.running}
            onClick={() => act(syncNowAction, "Checking for new sets…")}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Check now
          </Button>
        </div>
      </div>

      {t.total > 0 ? (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {t.current.length > 0 ? (
        <p className="mt-2 text-xs text-neutral-500">Now: {t.current.join(", ")}</p>
      ) : null}

      {failures.length > 0 ? (
        <details className="mt-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <CircleAlert className="h-4 w-4" /> {failures.length} set
            {failures.length === 1 ? "" : "s"} couldn&apos;t be synced — retried automatically on
            the next run
          </summary>
          <IssueList issues={failures} />
        </details>
      ) : null}

      {unavailable.length > 0 ? (
        <details className="mt-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
            <CircleAlert className="h-4 w-4 text-neutral-400" /> {unavailable.length} set
            {unavailable.length === 1 ? "" : "s"} not available at the source — checked again about
            once a month
          </summary>
          <p className="mt-2 text-xs text-neutral-500">
            These aren&apos;t errors on your side: the source lists them but has no card data.
          </p>
          <IssueList issues={unavailable} />
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={() => act(() => retryFailedSetsAction(true), "Checking those sets again…")}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Check them now
          </Button>
        </details>
      ) : null}
    </section>
  );
}
