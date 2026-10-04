import { prisma } from "./client";

/**
 * The Living Pokédex goal: one card of every Pokémon. A Pokémon counts once
 * you own any card of it, in any print, finish or language. Built from the
 * CardDex index (src/dex.ts), so tag-team cards count for each Pokémon on them.
 */

export const GENERATIONS = [
  { gen: 1, name: "Kanto", from: 1, to: 151 },
  { gen: 2, name: "Johto", from: 152, to: 251 },
  { gen: 3, name: "Hoenn", from: 252, to: 386 },
  { gen: 4, name: "Sinnoh", from: 387, to: 493 },
  { gen: 5, name: "Unova", from: 494, to: 649 },
  { gen: 6, name: "Kalos", from: 650, to: 721 },
  { gen: 7, name: "Alola", from: 722, to: 809 },
  { gen: 8, name: "Galar & Hisui", from: 810, to: 905 },
  { gen: 9, name: "Paldea", from: 906, to: 1025 },
] as const;

export interface PokedexSample {
  printingId: string;
  imageKey: string | null;
  cardName: string;
  collectorNumber: string;
  setCode: string;
}

export interface PokedexEntry {
  dexId: number;
  name: string;
  /** Copies owned of any card of this Pokémon. */
  copies: number;
  sample: PokedexSample | null;
}

export interface PokedexGeneration {
  gen: number;
  name: string;
  entries: PokedexEntry[];
  owned: number;
}

export interface Pokedex {
  generations: PokedexGeneration[];
  owned: number;
  total: number;
}

/** The plain Pokémon name among card names: the shortest Latin-script one ("Pikachu" over "Pikachu V"). */
export function pokemonNameFrom(cardNames: string[]): string | null {
  const latin = cardNames.filter((n) => /^[A-Za-z]/.test(n));
  const pool = latin.length > 0 ? latin : cardNames;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
}

/** Which generation a National Dex id belongs to (ids past the last range join the last). */
export function generationOf(dexId: number): number {
  return GENERATIONS.find((g) => dexId >= g.from && dexId <= g.to)?.gen ?? GENERATIONS.length;
}

/** Card names per Pokédex number: it changes only with a catalog sync, but takes ~1 s to build. */
let namesCache: { at: number; rows: Array<{ dexId: number; name: string }> } | null = null;
const NAMES_CACHE_MS = 10 * 60_000;

async function dexNames(): Promise<Array<{ dexId: number; name: string }>> {
  if (namesCache && Date.now() - namesCache.at < NAMES_CACHE_MS) return namesCache.rows;
  const rows = await prisma.$queryRaw<Array<{ dexId: number; name: string }>>`
      SELECT d."dexId" AS dexId, c."name" AS name
      FROM "CardDex" d
      JOIN "Card" c ON c."id" = d."cardId"
      JOIN "Game" g ON g."id" = c."gameId"
      WHERE g."slug" = 'pokemon'
        AND d."cardId" IN (SELECT "cardId" FROM "CardDex" GROUP BY "cardId" HAVING COUNT(*) = 1)
      GROUP BY d."dexId", c."name"`;
  namesCache = { at: Date.now(), rows };
  return rows;
}

export async function livingPokedex(): Promise<Pokedex> {
  const [names, owned] = await Promise.all([
    dexNames(),
    prisma.$queryRaw<
      Array<{
        dexId: number;
        quantity: number;
        printingId: string;
        imageKey: string | null;
        cardName: string;
        collectorNumber: string;
        setCode: string;
      }>
    >`
      SELECT d."dexId" AS dexId, ci."quantity" AS quantity, p."id" AS printingId,
             p."imageKey" AS imageKey, c."name" AS cardName,
             p."collectorNumber" AS collectorNumber, s."code" AS setCode
      FROM "CollectionItem" ci
      JOIN "PrintVariant" v ON v."id" = ci."variantId"
      JOIN "Printing" p ON p."id" = v."printingId"
      JOIN "Card" c ON c."id" = p."cardId"
      JOIN "CardDex" d ON d."cardId" = c."id"
      JOIN "Set" s ON s."id" = p."setId"
      ORDER BY ci."createdAt" ASC`,
  ]);

  const namesByDex = new Map<number, string[]>();
  for (const r of names) {
    const list = namesByDex.get(r.dexId) ?? [];
    list.push(r.name);
    namesByDex.set(r.dexId, list);
  }
  // A Pokémon that only appears on multi-Pokémon cards still counts; its name is then unknown.
  const allIds = new Set<number>(namesByDex.keys());
  const ownedBy = new Map<number, PokedexEntry>();
  for (const r of owned) {
    allIds.add(r.dexId);
    const entry = ownedBy.get(r.dexId) ?? { dexId: r.dexId, name: "", copies: 0, sample: null };
    entry.copies += r.quantity;
    // Show a card with a scan when there is one.
    if (!entry.sample || (!entry.sample.imageKey && r.imageKey))
      entry.sample = {
        printingId: r.printingId,
        imageKey: r.imageKey,
        cardName: r.cardName,
        collectorNumber: r.collectorNumber,
        setCode: r.setCode,
      };
    ownedBy.set(r.dexId, entry);
  }

  const generations: PokedexGeneration[] = GENERATIONS.map((g) => ({
    gen: g.gen,
    name: g.name,
    entries: [],
    owned: 0,
  }));
  for (const dexId of [...allIds].sort((a, b) => a - b)) {
    const have = ownedBy.get(dexId);
    const entry: PokedexEntry = {
      dexId,
      name: pokemonNameFrom(namesByDex.get(dexId) ?? []) ?? `#${dexId}`,
      copies: have?.copies ?? 0,
      sample: have?.sample ?? null,
    };
    const gen = generations[generationOf(dexId) - 1]!;
    gen.entries.push(entry);
    if (entry.copies > 0) gen.owned++;
  }
  return {
    generations,
    owned: generations.reduce((s, g) => s + g.owned, 0),
    total: generations.reduce((s, g) => s + g.entries.length, 0),
  };
}
