"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { adjustCopiesAction, settleQuickAddAction } from "../app/actions";
import { useToast } from "../components/ui/toast";
import { QuickAddQueue } from "./quick-add-queue";

export interface VariantCounts {
  plain: number;
  total: number;
}

export interface QuickAddVariant {
  variantId: string;
  plain: number;
  total: number;
}

/**
 * Optimistic per-variant copy counts for a grid of tiles.
 *
 * Counts come from the server props, but a click updates them locally at
 * once; the requests are coalesced by QuickAddQueue and, once the burst has
 * been idle, one snapshot + one `router.refresh()` brings the rest of the page
 * (headers, totals) up to date. A refresh never overwrites a variant that was
 * clicked since it began, so in-flight optimistic counts survive it.
 */
export function useQuickAdd(variants: QuickAddVariant[]) {
  const router = useRouter();
  const toast = useToast();

  const fromServer = (list: QuickAddVariant[]) =>
    Object.fromEntries(list.map((v) => [v.variantId, { plain: v.plain, total: v.total }]));
  const [counts, setCounts] = useState<Record<string, VariantCounts>>(() => fromServer(variants));
  const countsRef = useRef(counts);
  /** Variants clicked since the last settle: their local counts win over props. */
  const touched = useRef(new Set<string>());
  const queue = useRef<QuickAddQueue | null>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const commit = useCallback((next: Record<string, VariantCounts>) => {
    countsRef.current = next;
    setCounts(next);
  }, []);

  // New props (after router.refresh, or a navigation that reuses this grid).
  useEffect(() => {
    const server = fromServer(variants);
    const next: Record<string, VariantCounts> = {};
    for (const id of Object.keys(server)) {
      next[id] =
        touched.current.has(id) && countsRef.current[id] ? countsRef.current[id] : server[id];
    }
    commit(next);
  }, [variants, commit]);

  useEffect(() => {
    const q = new QuickAddQueue({
      send: (variantId, delta) => adjustCopiesAction(variantId, delta),
      onFail: (variantId, lost, error) => {
        const cur = countsRef.current[variantId];
        if (cur) {
          commit({
            ...countsRef.current,
            [variantId]: {
              plain: Math.max(0, cur.plain - lost),
              total: Math.max(0, cur.total - lost),
            },
          });
        }
        toastRef.current("error", error);
      },
      onSettle: async () => {
        // Clicks after this point keep their local count over the refreshed props.
        touched.current.clear();
        await settleQuickAddAction();
        router.refresh();
      },
    });
    queue.current = q;
    return () => {
      q.dispose();
      queue.current = null;
    };
  }, [router, commit]);

  const adjust = useCallback(
    (variantId: string, delta: 1 | -1) => {
      const cur = countsRef.current[variantId];
      if (!cur || !queue.current) return;
      if (delta < 0 && cur.plain <= 0) return;
      touched.current.add(variantId);
      commit({
        ...countsRef.current,
        [variantId]: { plain: cur.plain + delta, total: cur.total + delta },
      });
      queue.current.push(variantId, delta);
    },
    [commit],
  );

  return { counts, adjust };
}
