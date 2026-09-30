"use client";

import { useScrollMemory } from "../lib/scroll-memory";

/**
 * Drop into a server-rendered list page (search, set list…) to have its scroll
 * position restored on back. The page's filters/page number live in the URL,
 * so the URL itself (path + query) is the key.
 */
export function RestoreScroll() {
  useScrollMemory(() => `list-state:${location.pathname}${location.search}`);
  return null;
}
