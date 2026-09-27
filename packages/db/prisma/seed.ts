import { Finish, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GAMES = [
  { slug: "pokemon", name: "Pokémon" },
  { slug: "yugioh", name: "Yu-Gi-Oh!" },
  { slug: "one-piece", name: "One Piece" },
] as const;

// BCP-47 codes for the languages these three games are actually printed in.
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ja", name: "Japanese" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "ko", name: "Korean" },
  { code: "zh-Hans", name: "Chinese (Simplified)" },
  { code: "zh-Hant", name: "Chinese (Traditional)" },
] as const;

// One starter FoilProfile per Finish so every PrintVariant can point at
// *something* in packages/card-fx before real per-set profiles are synced.
// `shader` names a preset that will exist in packages/card-fx; for now they
// all resolve to the generic fallback preset.
function defaultFoilProfiles() {
  return Object.values(Finish).map((finish) => ({
    slug: `default-${finish.toLowerCase().replace(/_/g, "-")}`,
    shader: finish === Finish.NON_FOIL ? "flat" : "generic-foil",
    params: finish === Finish.NON_FOIL ? {} : { intensity: 0.6, hueSpread: 0.3, grainScale: 1 },
  }));
}

async function main() {
  for (const game of GAMES) {
    await prisma.game.upsert({
      where: { slug: game.slug },
      update: { name: game.name },
      create: game,
    });
  }

  for (const language of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: language.code },
      update: { name: language.name },
      create: language,
    });
  }

  for (const profile of defaultFoilProfiles()) {
    await prisma.foilProfile.upsert({
      where: { slug: profile.slug },
      update: { shader: profile.shader, params: profile.params },
      create: profile,
    });
  }

  console.log(
    `Seeded ${GAMES.length} games, ${LANGUAGES.length} languages, ${defaultFoilProfiles().length} foil profiles.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
