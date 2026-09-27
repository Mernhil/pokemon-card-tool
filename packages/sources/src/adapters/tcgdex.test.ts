import { describe, expect, it } from "vitest";
import {
  mapTcgdexCardToSourcePrinting,
  mapTcgdexSetToSourceSet,
  type TcgdexCardInput,
  type TcgdexSetInput,
} from "./tcgdex";

describe("mapTcgdexSetToSourceSet", () => {
  it("maps a full TCGdex set onto SourceSet", () => {
    const set: TcgdexSetInput = {
      id: "sv06.5",
      name: "Shrouded Fable",
      logo: "https://assets.tcgdex.net/en/sv/sv06.5/logo",
      symbol: "https://assets.tcgdex.net/en/sv/sv06.5/symbol",
      releaseDate: "2024-08-02",
      serie: { name: "Scarlet & Violet" },
      cardCount: { official: 64, total: 99 },
    };

    expect(mapTcgdexSetToSourceSet(set)).toEqual({
      code: "sv06.5",
      name: "Shrouded Fable",
      series: "Scarlet & Violet",
      releaseDate: "2024-08-02",
      printedTotal: 64,
      totalCards: 99,
      logoUrl: "https://assets.tcgdex.net/en/sv/sv06.5/logo.png",
      symbolUrl: "https://assets.tcgdex.net/en/sv/sv06.5/symbol.png",
    });
  });

  it("tolerates missing optional fields", () => {
    const set: TcgdexSetInput = { id: "svp", name: "SVP Black Star Promos" };

    const mapped = mapTcgdexSetToSourceSet(set);

    expect(mapped.series).toBeUndefined();
    expect(mapped.releaseDate).toBeUndefined();
    expect(mapped.printedTotal).toBeUndefined();
    expect(mapped.totalCards).toBeUndefined();
    expect(mapped.logoUrl).toBeUndefined();
    expect(mapped.symbolUrl).toBeUndefined();
  });
});

describe("mapTcgdexCardToSourcePrinting", () => {
  it("maps a Pokemon card, folding gameplay fields into attributes", () => {
    const card: TcgdexCardInput = {
      id: "sv06.5-001",
      localId: "001",
      name: "Joltik",
      image: "https://assets.tcgdex.net/en/sv/sv06.5/001",
      illustrator: "Naoyo Kimura",
      rarity: "Common",
      category: "Pokemon",
      hp: 40,
      types: ["Grass"],
      stage: "Basic",
      attacks: [
        {
          cost: ["Grass"],
          name: "Splashing Dodge",
          effect: "Flip a coin.",
          damage: 10,
        },
      ],
      weaknesses: [{ type: "Fire", value: "×2" }],
      retreat: 1,
      regulationMark: "H",
      set: { cardCount: { official: 64, total: 99 } },
    };

    const mapped = mapTcgdexCardToSourcePrinting(card);

    expect(mapped.externalCardId).toBe("sv06.5-001");
    expect(mapped.cardName).toBe("Joltik");
    expect(mapped.cardType).toBe("Pokemon");
    expect(mapped.subtypes).toEqual(["Basic"]);
    expect(mapped.collectorNumber).toBe("001/64");
    expect(mapped.rarityName).toBe("Common");
    expect(mapped.artistName).toBe("Naoyo Kimura");
    expect(mapped.imageUrl).toBe("https://assets.tcgdex.net/en/sv/sv06.5/001/high.webp");
    expect(mapped.attributes).toEqual({
      hp: 40,
      types: ["Grass"],
      attacks: card.attacks,
      weaknesses: card.weaknesses,
      retreat: 1,
      regulationMark: "H",
    });
  });

  it("maps a Trainer card using effect/trainerType instead of Pokemon fields", () => {
    const card: TcgdexCardInput = {
      id: "sv06.5-054",
      localId: "054",
      name: "Academy at Night",
      illustrator: "AYUMI ODASHIMA",
      rarity: "Uncommon",
      category: "Trainer",
      effect:
        "Once during each player's turn, that player may put a card from their hand on top of their deck.",
      trainerType: "Stadium",
      regulationMark: "H",
      set: { cardCount: { official: 64, total: 99 } },
    };

    const mapped = mapTcgdexCardToSourcePrinting(card);

    expect(mapped.cardType).toBe("Trainer");
    expect(mapped.subtypes).toEqual(["Stadium"]);
    expect(mapped.imageUrl).toBeUndefined();
    expect(mapped.attributes.effect).toBe(card.effect);
    expect(mapped.attributes.hp).toBeUndefined();
  });

  it("falls back to the bare localId when the official set total is unknown", () => {
    const card: TcgdexCardInput = {
      id: "svp-SV001",
      localId: "SV001",
      name: "Pikachu",
      category: "Pokemon",
    };

    expect(mapTcgdexCardToSourcePrinting(card).collectorNumber).toBe("SV001");
  });

  it("defaults cardType to Unknown when TCGdex omits category", () => {
    const card: TcgdexCardInput = { id: "x-1", localId: "1", name: "Mystery Card" };

    expect(mapTcgdexCardToSourcePrinting(card).cardType).toBe("Unknown");
  });
});
