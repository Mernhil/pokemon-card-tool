import type { Prisma } from "./generated/node/client";
import { prisma } from "./client";

type Db = Prisma.TransactionClient;

/** The Pokédex ids in a card's `attributes` JSON (TCGdex stores them as `dexId: number[]`). */
export function dexIdsFromAttributes(attributes: unknown): number[] {
  let value: unknown = attributes;
  if (typeof attributes === "string") {
    try {
      value = JSON.parse(attributes);
    } catch {
      return [];
    }
  }
  const ids = (value as { dexId?: unknown } | null)?.dexId;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((n): n is number => Number.isInteger(n) && n > 0))];
}

/** Makes a card's CardDex rows match `dexIds` (used by the catalog sync after every card upsert). */
export async function setCardDex(db: Db, cardId: string, dexIds: number[]): Promise<void> {
  const existing = await db.cardDex.findMany({ where: { cardId }, select: { dexId: true } });
  const have = new Set(existing.map((r) => r.dexId));
  const want = new Set(dexIds);
  const add = dexIds.filter((id) => !have.has(id));
  const remove = existing.filter((r) => !want.has(r.dexId)).map((r) => r.dexId);
  if (add.length > 0) {
    await db.cardDex.createMany({ data: add.map((dexId) => ({ cardId, dexId })) });
  }
  if (remove.length > 0) await db.cardDex.deleteMany({ where: { cardId, dexId: { in: remove } } });
}

/**
 * Idempotent: fills CardDex for cards synced before it existed, from
 * `attributes.dexId`. Only looks at cards that carry a dexId but have no rows
 * yet, so repeating it is cheap. Returns the number of cards filled.
 */
export async function backfillCardDex(): Promise<number> {
  let filled = 0;
  let after = "";
  for (;;) {
    // Paged by id so cards whose dexId list is empty (nothing to store) cannot be found again.
    const cards = await prisma.card.findMany({
      where: { attributes: { contains: '"dexId"' }, dex: { none: {} }, id: { gt: after } },
      select: { id: true, attributes: true },
      orderBy: { id: "asc" },
      take: 2_000,
    });
    if (cards.length === 0) break;
    after = cards[cards.length - 1]!.id;
    const data = cards.flatMap((c) =>
      dexIdsFromAttributes(c.attributes).map((dexId) => ({ cardId: c.id, dexId })),
    );
    if (data.length > 0) {
      await prisma.cardDex.createMany({ data });
      filled += new Set(data.map((d) => d.cardId)).size;
    }
  }
  return filled;
}

/** Words that mark a card as a specific variant, not a bare Pokémon name ("Jirachi ex", "Mew VMAX"). */
const VARIANT_WORD = /\b(ex|gx|v|vmax|vstar|v-union|break|prime|star|lv\.?x|tera|mega)\b/i;

export interface PokemonMatch {
  dexId: number;
  /** The Pokémon's name as cards spell it ("Jirachi"). */
  name: string;
}

/**
 * When `query` is exactly a Pokémon's name (some card is named exactly that and
 * has a single National Dex id), which Pokémon it is. Case-insensitive, never
 * a prefix match: "Mew" is #151 and never Mewtwo (#150). A query naming a
 * variant ("Jirachi ex") is plain text, not a Pokémon name. null = use the
 * ordinary contains search.
 */
export async function findPokemonByName(query: string): Promise<PokemonMatch | null> {
  const q = query.trim();
  if (!q || VARIANT_WORD.test(q)) return null;
  const rows = await prisma.$queryRaw<Array<{ name: string; dexId: number }>>`
    SELECT c."name" AS name, d."dexId" AS dexId
    FROM "Card" c
    JOIN "CardDex" d ON d."cardId" = c."id"
    JOIN "Game" g ON g."id" = c."gameId"
    WHERE g."slug" = 'pokemon' AND lower(c."name") = lower(${q})`;
  if (rows.length === 0) return null;
  const ids = new Set(rows.map((r) => r.dexId));
  // A name shared by several Pokémon (or a tag-team card) isn't one Pokémon.
  if (ids.size !== 1) return null;
  return { dexId: rows[0]!.dexId, name: rows[0]!.name };
}
