import { prisma } from "./client";

export interface LanguageSibling {
  languageCode: string;
  setCode: string;
  collectorNumber: string;
}

/** Releases further apart than this are not the same print run (Japanese and English sets lag by months). */
const MAX_RELEASE_GAP_MS = 550 * 86_400_000;

function hpOf(attributes: string): number | null {
  try {
    const hp = (JSON.parse(attributes) as { hp?: unknown }).hp;
    return typeof hp === "number" ? hp : null;
  } catch {
    return null;
  }
}

/**
 * The same Pokémon card printed in another language (a Japanese card -> its
 * English reprint and back). No source links the two, so a candidate must
 * match on the same Pokémon (Pokédex ids), the same illustrator and the same
 * HP, and sits in a set released within about 18 months. If several remain
 * the one released closest wins. Returns at most one printing per language;
 * none when nothing matches well enough.
 */
export async function findLanguageSiblings(printingId: string): Promise<LanguageSibling[]> {
  const p = await prisma.printing.findUnique({
    where: { id: printingId },
    include: { set: { include: { game: true } }, card: { include: { dex: true } } },
  });
  if (!p || p.set.game.slug !== "pokemon" || p.artistId === null) return [];
  const dex = p.card.dex.map((d) => d.dexId).sort((a, b) => a - b);
  if (dex.length === 0) return [];
  const myLang = p.set.primaryLangCode ?? "en";
  const hp = hpOf(p.card.attributes);

  const candidates = await prisma.printing.findMany({
    where: {
      id: { not: p.id },
      artistId: p.artistId,
      set: { gameId: p.set.gameId },
      card: { dex: { some: { dexId: { in: dex } } } },
    },
    include: { set: true, card: { include: { dex: true } } },
  });

  const best = new Map<string, { sibling: LanguageSibling; gap: number }>();
  for (const c of candidates) {
    const lang = c.set.primaryLangCode ?? "en";
    if (lang === myLang) continue;
    const theirDex = c.card.dex.map((d) => d.dexId).sort((a, b) => a - b);
    if (theirDex.length !== dex.length || theirDex.some((id, i) => id !== dex[i])) continue;
    if (hp !== hpOf(c.card.attributes)) continue;
    // Sets without a date can't be compared: only accept them if nothing else exists.
    const gap =
      p.set.releaseDate && c.set.releaseDate
        ? Math.abs(p.set.releaseDate.getTime() - c.set.releaseDate.getTime())
        : null;
    if (gap !== null && gap > MAX_RELEASE_GAP_MS) continue;
    const known = best.get(lang);
    const score = gap ?? Number.MAX_SAFE_INTEGER;
    if (!known || score < known.gap) {
      best.set(lang, {
        gap: score,
        sibling: { languageCode: lang, setCode: c.set.code, collectorNumber: c.collectorNumber },
      });
    }
  }
  return [...best.values()].map((b) => b.sibling);
}
