import { cardSlug } from "@tcg-vault/shared/src/card-slug";

export { cardSlug };

/** Canonical ordering of finishes when listing a printing's variants. */
const FINISH_ORDER = ["NON_FOIL", "HOLO", "REVERSE_HOLO"];

export function sortByFinish<T extends { finish: string; edition?: string }>(variants: T[]): T[] {
  const rank = (f: string) => {
    const i = FINISH_ORDER.indexOf(f);
    return i === -1 ? FINISH_ORDER.length : i;
  };
  const ed = (v: { edition?: string }) => Number(!!v.edition && v.edition !== "UNLIMITED");
  return [...variants].sort((a, b) => ed(a) - ed(b) || rank(a.finish) - rank(b.finish));
}

export function cardHref(gameSlug: string, setCode: string, collectorNumber: string): string {
  return `/${gameSlug}/${encodeURIComponent(setCode)}/${encodeURIComponent(cardSlug(collectorNumber))}`;
}
