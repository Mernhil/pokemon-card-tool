import { createHash } from "node:crypto";

/** Lowercase + trim + collapse internal whitespace runs into a single space. */
function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Stable identity for a gameplay card that's independent of formatting
 * differences between sources/printings ("Charizard" reprinted a dozen
 * times should map to one Card row). Used as `Card.canonicalKey` — see
 * packages/db/prisma/schema.prisma. For games with a real external
 * identity (YGO passcode, One Piece card id) prefer that instead; this
 * hash is the fallback used for Pokemon.
 */
export function canonicalKeyFor(name: string, rulesText?: string): string {
  const input = `${normalize(name)}|${normalize(rulesText ?? "")}`;
  return createHash("sha1").update(input).digest("hex");
}
