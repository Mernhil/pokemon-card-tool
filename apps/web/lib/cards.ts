/** Canonical ordering of finishes when listing a printing's variants. */
const FINISH_ORDER = ["NON_FOIL", "HOLO", "REVERSE_HOLO"];

export function sortByFinish<T extends { finish: string }>(variants: T[]): T[] {
  const rank = (f: string) => {
    const i = FINISH_ORDER.indexOf(f);
    return i === -1 ? FINISH_ORDER.length : i;
  };
  return [...variants].sort((a, b) => rank(a.finish) - rank(b.finish));
}

import { cardSlug } from "@tcg-vault/shared";

export { cardSlug };

export function cardHref(gameSlug: string, setCode: string, collectorNumber: string): string {
  return `/${gameSlug}/${encodeURIComponent(setCode)}/${encodeURIComponent(cardSlug(collectorNumber))}`;
}
