import { TCGDEX_LANGUAGES } from "@tcg-vault/shared";
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
export async function findLanguageSiblings(
  printingId: string,
  { exactOnly = false }: { exactOnly?: boolean } = {},
): Promise<LanguageSibling[]> {
  const p = await prisma.printing.findUnique({
    where: { id: printingId },
    include: { set: { include: { game: true } }, card: { include: { dex: true } } },
  });
  if (!p || p.set.game.slug !== "pokemon" || p.artistId === null) return [];
  const dex = p.card.dex.map((d) => d.dexId).sort((a, b) => a - b);
  if (dex.length === 0) return [];
  const myLang = p.set.primaryLangCode ?? "en";
  const hp = hpOf(p.card.attributes);

  // Sharing a picture needs certainty: only the same set and number, never a lookalike.
  const candidates = exactOnly ? [] : await prisma.printing.findMany({
    where: {
      id: { not: p.id },
      artistId: p.artistId,
      set: { gameId: p.set.gameId },
      card: { dex: { some: { dexId: { in: dex } } } },
    },
    include: { set: true, card: { include: { dex: true } } },
  });

  const best = new Map<string, { sibling: LanguageSibling; gap: number }>();

  // Same set, same number: TCGdex uses one set id in every language ("30th", "it-30th") and
  // numbers the cards alike. This is the reliable link — name and HP differ between languages
  // (the same Meowth is 50 HP in English and 70 in Italian), so they are not compared here.
  const prefixOf = (lang: string) => TCGDEX_LANGUAGES.find((l) => l.code === lang)?.prefix ?? "";
  const bareCode = p.set.code.startsWith(prefixOf(myLang)) ? p.set.code.slice(prefixOf(myLang).length) : p.set.code;
  if (!/^(JP|EN)-/.test(p.set.code)) {
    const sameSet = await prisma.printing.findMany({
      where: {
        collectorNumber: p.collectorNumber,
        set: {
          gameId: p.set.gameId,
          code: { in: ["en", ...TCGDEX_LANGUAGES.map((l) => l.code)].map((l) => (l === "en" ? bareCode : prefixOf(l) + bareCode)) },
        },
      },
      include: { set: true, card: { include: { dex: true } } },
    });
    for (const c of sameSet) {
      const lang = c.set.primaryLangCode ?? "en";
      if (c.id === p.id || lang === myLang) continue;
      const theirDex = c.card.dex.map((d) => d.dexId).sort((a, b) => a - b);
      if (theirDex.length !== dex.length || theirDex.some((id, i) => id !== dex[i])) continue;
      best.set(lang, {
        gap: -1,
        sibling: { languageCode: lang, setCode: c.set.code, collectorNumber: c.collectorNumber },
      });
    }
  }
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
