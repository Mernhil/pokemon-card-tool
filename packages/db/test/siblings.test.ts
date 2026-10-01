import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { findLanguageSiblings } from "../src/siblings";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());

async function seedPrinting(opts: {
  game: { id: number };
  lang: string;
  setCode: string;
  released: string;
  number: string;
  name: string;
  dex: number[];
  hp: number;
  artistId: number;
}) {
  await prisma.language.upsert({ where: { code: opts.lang }, update: {}, create: { code: opts.lang, name: opts.lang } });
  const set = await prisma.set.upsert({
    where: { gameId_code: { gameId: opts.game.id, code: opts.setCode } },
    update: {},
    create: {
      gameId: opts.game.id,
      code: opts.setCode,
      name: opts.setCode,
      primaryLangCode: opts.lang,
      releaseDate: new Date(opts.released),
    },
  });
  const card = await prisma.card.create({
    data: {
      gameId: opts.game.id,
      name: opts.name,
      cardType: "Pokemon",
      attributes: JSON.stringify({ hp: opts.hp }),
      canonicalKey: `${opts.setCode}-${opts.number}`,
      dex: { create: opts.dex.map((dexId) => ({ dexId })) },
    },
  });
  return prisma.printing.create({
    data: {
      cardId: card.id,
      setId: set.id,
      collectorNumber: opts.number,
      sortNumber: parseInt(opts.number, 10),
      artistId: opts.artistId,
    },
  });
}

describe("findLanguageSiblings", () => {
  beforeEach(resetDb);

  it("pairs the same Pokémon, illustrator and HP across languages, closest release first", async () => {
    const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokemon" } });
    const artist = await prisma.artist.create({ data: { name: "Tika Matsuno" } });
    const base = { game, dex: [331], hp: 60, artistId: artist.id };
    const ja = await seedPrinting({ ...base, lang: "ja", setCode: "ja-SV1S", released: "2023-01-20", number: "001/78", name: "サボネア" });
    await seedPrinting({ ...base, lang: "en", setCode: "sv01", released: "2023-03-31", number: "005/198", name: "Cacnea" });
    // Same Pokémon and artist but another HP, and a reprint years later: neither is a match.
    await seedPrinting({ ...base, hp: 70, lang: "en", setCode: "sv02", released: "2023-06-01", number: "009/193", name: "Cacnea" });
    await seedPrinting({ ...base, lang: "en", setCode: "sv99", released: "2027-01-01", number: "001/10", name: "Cacnea" });

    expect(await findLanguageSiblings(ja.id)).toEqual([
      { languageCode: "en", setCode: "sv01", collectorNumber: "005/198" },
    ]);
  });

  it("finds nothing when no illustrator is known", async () => {
    const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokemon" } });
    const artist = await prisma.artist.create({ data: { name: "A" } });
    const p = await seedPrinting({ game, dex: [1], hp: 40, artistId: artist.id, lang: "en", setCode: "x", released: "2023-01-01", number: "1", name: "X" });
    await prisma.printing.update({ where: { id: p.id }, data: { artistId: null } });
    expect(await findLanguageSiblings(p.id)).toEqual([]);
  });
});
