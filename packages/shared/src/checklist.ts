/**
 * Checklist mode on a set page: type a collector number, press Enter, the
 * card goes in. "25" is one copy, "25x3" or "25*3" three. Pure, so the
 * matching rules are tested here and the component only does the typing.
 */

export interface ChecklistEntry {
  /** What was typed for the card, trimmed. */
  number: string;
  quantity: number;
}

export function parseChecklistEntry(text: string): ChecklistEntry | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const m = /^(.*\S)\s*[x*×]\s*(\d{1,3})$/i.exec(trimmed);
  if (m) {
    const quantity = Number(m[2]);
    // "TG01x" style typos have no number to look up; "x3" alone is not an entry.
    return quantity > 0 ? { number: m[1]!.trim(), quantity } : null;
  }
  return { number: trimmed, quantity: 1 };
}

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, "");

/** "025/198" -> "025": the number as printed before the set total. */
const printed = (collectorNumber: string) => norm(collectorNumber.split("/")[0] ?? "");

/**
 * The card a typed number means: an exact match on the printed number
 * ("TG01", "svp123"), else a numeric one ("25" finds "025/198"). Null if none
 * or if more than one card matches numerically.
 */
export function matchChecklistCard<T extends { number: string }>(
  cards: T[],
  typed: string,
): T | null {
  const want = norm(typed);
  if (!want) return null;
  const exact = cards.filter((c) => printed(c.number) === want);
  if (exact.length === 1) return exact[0]!;
  if (/^\d+$/.test(want)) {
    const n = Number(want);
    const numeric = cards.filter((c) => /^\d+$/.test(printed(c.number)) && Number(printed(c.number)) === n);
    if (numeric.length === 1) return numeric[0]!;
  }
  return null;
}

/**
 * Which of a card's finishes an entry goes into: the chosen one if the card
 * has it, else the card's plainest finish. `finishes` are variant kinds
 * (finish or EDITION:FINISH); a chosen finish matches ordinary prints only.
 */
export function pickChecklistFinish(finishes: string[], chosen: string): string | null {
  if (finishes.length === 0) return null;
  if (finishes.includes(chosen)) return chosen;
  const order = ["NON_FOIL", "HOLO", "REVERSE_HOLO"];
  const ordinary = finishes.filter((f) => !f.includes(":"));
  const pool = ordinary.length ? ordinary : finishes;
  return [...pool].sort((a, b) => rank(order, a) - rank(order, b))[0]!;
}

const rank = (order: string[], f: string) => {
  const i = order.indexOf(f);
  return i < 0 ? order.length : i;
};
