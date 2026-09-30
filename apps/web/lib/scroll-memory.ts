"use client";

import { useEffect } from "react";
import { shouldRecordScroll, startScrollRestore } from "@tcg-vault/shared/src/scroll-restore";

/** What a list page keeps in sessionStorage for its URL. */
export interface StoredListState<F = unknown> {
  scroll?: number;
  filters?: F;
}

export function readStored<F>(key: string): StoredListState<F> | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredListState<F>) : null;
  } catch {
    return null;
  }
}

/** Merges `patch` into the stored entry (scroll and filters are written independently). */
export function writeStored<F>(key: string, patch: StoredListState<F>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...readStored<F>(key), ...patch }));
  } catch {
    // Storage full or unavailable — losing the restore point isn't fatal.
  }
}

const SAVE_EVERY_MS = 120;
const USER_INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Remembers this page's scroll position and puts it back when the page is
 * shown again — after an in-app link, router.back(), Alt+Left or the mouse
 * side button alike, since they all just mount the page.
 *
 * Why not rely on the router/browser:
 * - Next scrolls to the top on navigation, and that scroll event used to be
 *   what the old save-on-unmount captured, so the stored position was 0.
 *   Here the position is saved continuously (throttled scroll + pagehide),
 *   ignoring scroll events once the URL has changed or while we're restoring.
 * - The browser's own restoration runs before the page has its content and
 *   is clamped to the short page. We switch `history.scrollRestoration` to
 *   "manual" while the page is mounted and retry until the page is tall
 *   enough and the position has held.
 *
 * `getKey` runs in the effect (client only), so it can read `location`.
 */
export function useScrollMemory(getKey: () => string): void {
  useEffect(() => {
    const key = getKey();
    const ownerHref = location.pathname + location.search;
    const previousMode = history.scrollRestoration;
    history.scrollRestoration = "manual";

    let restoring = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSaved = -1;

    const save = () => {
      timer = null;
      if (restoring || !shouldRecordScroll(ownerHref, location.pathname + location.search)) return;
      const y = Math.round(window.scrollY);
      if (y === lastSaved) return;
      lastSaved = y;
      writeStored(key, { scroll: y });
    };
    const onScroll = () => {
      if (restoring || timer) return;
      timer = setTimeout(save, SAVE_EVERY_MS);
    };

    const target = readStored(key)?.scroll ?? 0;
    let handle: ReturnType<typeof startScrollRestore> | null = null;
    const stopRestoring = () => {
      handle?.cancel();
      restoring = false;
    };
    if (target > 0) {
      restoring = true;
      handle = startScrollRestore(target, {
        now: () => performance.now(),
        requestFrame: (cb) => {
          const id = requestAnimationFrame(cb);
          return () => cancelAnimationFrame(id);
        },
        scrollY: () => window.scrollY,
        maxScrollY: () => document.documentElement.scrollHeight - window.innerHeight,
        scrollTo: (y) => window.scrollTo(0, y),
      });
      void handle.done.then(() => {
        restoring = false;
      });
      // The user taking over wins over the restore.
      for (const ev of USER_INPUT_EVENTS) {
        window.addEventListener(ev, stopRestoring, { passive: true, once: true });
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      for (const ev of USER_INPUT_EVENTS) window.removeEventListener(ev, stopRestoring);
      if (timer) clearTimeout(timer);
      handle?.cancel();
      history.scrollRestoration = previousMode;
    };
    // The key is derived once per mount; a different URL is a different mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
