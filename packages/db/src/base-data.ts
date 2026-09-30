import { classifySet } from "@tcg-vault/shared";
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
 * Idempotent: gives every existing set its category (Set.category) from
 * classifySet. The column is added by a SQL migration with default "main";
 * this fills it in for sets synced before it existed, and corrects any whose
 * rules have changed. Run at startup next to ensureBaseData. Returns how many
 * rows it changed.
 */
export async function backfillSetCategories(): Promise<number> {
  const sets = await prisma.set.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      series: true,
      category: true,
      game: { select: { slug: true } },
    },
  });
  let changed = 0;
  for (const set of sets) {
    const category = classifySet({
      game: set.game.slug,
      code: set.code,
      name: set.name,
      series: set.series,
    });
    if (category === set.category) continue;
    await prisma.set.update({ where: { id: set.id }, data: { category } });
    changed++;
  }
  return changed;
}

/**
 * Idempotent: gives Pokémon printings that have no image key yet the lazy
 * `remote/<id>` key, so the image cache tries the constructed CDN addresses
 * for them (they used to show "image not available" forever when the catalog
 * stored no URL), and printings with a custom image get the key too. Returns
 * how many rows it changed.
 */
export async function backfillImageKeys(): Promise<number> {
  return prisma.$executeRawUnsafe(
    `UPDATE "Printing" SET "imageKey" = 'remote/' || "id"
     WHERE "imageKey" IS NULL
       AND ("customImageKey" IS NOT NULL
            OR "setId" IN (SELECT s."id" FROM "Set" s JOIN "Game" g ON g."id" = s."gameId" WHERE g."slug" = 'pokemon'))`,
  );
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
