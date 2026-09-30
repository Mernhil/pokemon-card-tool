"use client";

import { usePathname } from "next/navigation";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { readStored, useScrollMemory, writeStored } from "./scroll-memory";

/**
 * Filter state that survives a round trip to a card's detail page and back:
 * restored from sessionStorage on mount and saved whenever it changes, keyed
 * by the current path so each collection/set view keeps its own. Scroll
 * position is handled by useScrollMemory (same storage entry).
 */
export function useListState<F extends object>(
  defaultFilters: F,
): [F, Dispatch<SetStateAction<F>>] {
  const pathname = usePathname();
  const storageKey = `list-state:${pathname}`;

  const [filters, setFilters] = useState<F>(() => {
    if (typeof window === "undefined") return defaultFilters;
    const stored = readStored<F>(storageKey);
    return stored?.filters ? { ...defaultFilters, ...stored.filters } : defaultFilters;
  });

  useEffect(() => {
    writeStored(storageKey, { filters });
  }, [storageKey, filters]);

  useScrollMemory(() => storageKey);

  return [filters, setFilters];
}
