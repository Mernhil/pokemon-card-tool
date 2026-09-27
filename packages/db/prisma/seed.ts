import { prisma } from "../src";

/** Minimal local dev seed: the three games, nothing else. Catalog itself comes from sync-catalog. */
async function main() {
  const games = [
    { slug: "pokemon", name: "Pokémon" },
    { slug: "yugioh", name: "Yu-Gi-Oh!" },
    { slug: "one-piece", name: "One Piece" },
  ];

  for (const game of games) {
    await prisma.game.upsert({
      where: { slug: game.slug },
      update: {},
      create: game,
    });
  }

  const languages = [
    { code: "en", name: "English" },
    { code: "ja", name: "Japanese" },
    { code: "fr", name: "French" },
    { code: "de", name: "German" },
    { code: "it", name: "Italian" },
    { code: "es", name: "Spanish" },
  ];

  for (const language of languages) {
    await prisma.language.upsert({
      where: { code: language.code },
      update: {},
      create: language,
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
