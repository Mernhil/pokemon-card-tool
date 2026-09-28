import { prisma } from "./client";

const GAMES = [
  { slug: "pokemon", name: "Pokémon" },
  { slug: "yugioh", name: "Yu-Gi-Oh!" },
  { slug: "one-piece", name: "One Piece" },
];

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ja", name: "Japanese" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "es", name: "Spanish" },
];

/**
 * Idempotent: the games and languages every screen assumes exist. Run on
 * every server start (apps/web/instrumentation.ts) because the desktop app's
 * fresh per-user database never goes through `pnpm db:seed`.
 */
export async function ensureBaseData(): Promise<void> {
  for (const game of GAMES) {
    await prisma.game.upsert({ where: { slug: game.slug }, update: {}, create: game });
  }
  for (const language of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: language.code },
      update: {},
      create: language,
    });
  }
}

/**
 * WAL journal mode: pages keep reading while a background sync writes (in
 * the default rollback mode a writer blocks readers). Persistent per DB
 * file; harmless to repeat. Best-effort — never blocks startup.
 */
export async function enableConcurrentReads(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  } catch (err) {
    console.warn("[db] couldn't enable WAL mode:", err);
  }
}
