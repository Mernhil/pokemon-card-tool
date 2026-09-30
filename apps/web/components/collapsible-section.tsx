"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * A heading that folds its content away, collapsed by default. The open/closed
 * state is remembered per `storageKey` in localStorage (best-effort: private
 * windows and blocked storage just fall back to collapsed).
 */
export function CollapsibleSection({
  storageKey,
  title,
  summary,
  children,
}: {
  storageKey: string;
  title: string;
  /** e.g. "12 sets · 34/410 cards" */
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "1") setOpen(true);
    } catch {
      // Storage unavailable: stay collapsed.
    }
  }, [storageKey]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // Not remembered, still works.
    }
  };

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="panel flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2"
      >
        <span className="flex items-center gap-2">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="text-sm font-semibold">{title}</span>
        </span>
        <span className="text-xs text-neutral-500">{summary}</span>
      </button>
      <div hidden={!open} className="mt-4">
        {children}
      </div>
    </section>
  );
}
