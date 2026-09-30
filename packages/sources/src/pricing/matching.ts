/**
 * Card matching rules shared by the providers. A card is identified by
 * set + collector number + name (+ language and finish, handled by each
 * provider's price filter) — never by name alone: "Pikachu" alone matches
 * hundreds of printings.
 */

/** Lowercase ASCII words: "Pokémon GO: Pikachu & Zekrom-GX" -> "pokemon go pikachu and zekrom gx". */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Collector number without the "/total" part, leading zeros or spacing:
 * "001/064" -> "1", "TG01/TG30" -> "tg1", "SVP 123" -> "svp123", "GG05" -> "gg5".
 */
export function normalizeNumber(value: string): string {
  const local = value
    .split("/")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const match = local.match(/^([a-z]*)0*(\d+)([a-z]*)$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : local;
}

/** Word overlap (Jaccard) of two normalized names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export interface MatchScore {
  score: number;
  reason: string;
}

/**
 * How well a provider's card (name + collector number) matches ours, 0..1.
 * The number must match: a name-only match scores 0.
 */
export function scoreCardMatch(
  ours: { name: string; number: string },
  theirs: { name: string; number: string | null | undefined },
): MatchScore {
  if (!theirs.number) return { score: 0, reason: "the provider gives no collector number" };
  if (normalizeNumber(ours.number) !== normalizeNumber(theirs.number)) {
    return { score: 0, reason: "collector number differs" };
  }
  const exact = normalizeName(ours.name) === normalizeName(theirs.name);
  if (exact) return { score: 1, reason: "collector number + card name" };
  const similarity = nameSimilarity(ours.name, theirs.name);
  if (similarity >= 0.5)
    return { score: 0.85, reason: `collector number + similar name ("${theirs.name}")` };
  return { score: 0.5, reason: `collector number only — name differs ("${theirs.name}")` };
}

/** How well a provider's expansion matches our set, 0..1. */
export function scoreSetMatch(
  ours: { code: string; name: string },
  theirs: { code?: string | null; name: string },
): MatchScore {
  if (normalizeName(ours.name) === normalizeName(theirs.name))
    return { score: 1, reason: "set name" };
  if (theirs.code && theirs.code.toLowerCase() === ours.code.toLowerCase()) {
    return { score: 0.95, reason: "set code" };
  }
  const similarity = nameSimilarity(ours.name, theirs.name);
  if (similarity >= 0.75) return { score: 0.7, reason: `similar set name ("${theirs.name}")` };
  // Galleries / vaults our catalog lists as their own set ("Astral Radiance Trainer Gallery")
  // are often filed by the provider inside the parent expansion ("Astral Radiance"): every
  // word of its name is in ours. The card number must still match, so this only widens the search.
  const theirWords = normalizeName(theirs.name).split(" ").filter(Boolean);
  const ourWords = new Set(normalizeName(ours.name).split(" "));
  if (theirWords.length >= 2 && theirWords.every((w) => ourWords.has(w))) {
    return { score: 0.6, reason: `parent expansion ("${theirs.name}")` };
  }
  return { score: 0, reason: "set differs" };
}
