"use client";

import { usePathname } from "next/navigation";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

interface Stored<F> {
  scroll: number;
  filters: F;
}

/**
 * Filter state that survives a round trip to a card's detail page and back:
 * restored from sessionStorage on mount (scroll position included) and
 * saved when the list unmounts, keyed by the current path so each
 * collection/set view keeps its own.
 */
export function useListState<F extends object>(
  defaultFilters: F,
  /** Extra key for pages whose state belongs to one query (the search page: one entry per search). */
  scope?: string,
): [F, Dispatch<SetStateAction<F>>] {
  const pathname = usePathname();
  const storageKey = `list-state:${pathname}${scope ? `?${scope}` : ""}`;

  const [filters, setFilters] = useState<F>(() => {
    if (typeof window === "undefined") return defaultFilters;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return defaultFilters;
      const parsed = JSON.parse(raw) as Stored<F>;
      return { ...defaultFilters, ...parsed.filters };
    } catch {
      return defaultFilters;
    }
  });

  const scrollRef = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    // Restore scroll once, after the restored filters have had a chance to paint.
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stored<F>;
      if (typeof parsed.scroll === "number" && parsed.scroll > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => window.scrollTo(0, parsed.scroll));
        });
      }
    } catch {
      // Corrupt storage entry — nothing to restore.
    }
    // Only on mount: this reads the position saved by the previous visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onScroll = () => {
      scrollRef.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ scroll: scrollRef.current, filters: filtersRef.current }),
        );
      } catch {
        // Storage full or unavailable — losing the restore point isn't fatal.
      }
    };
  }, [storageKey]);

  return [filters, setFilters];
}
