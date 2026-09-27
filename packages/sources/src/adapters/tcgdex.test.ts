import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finishesFor,
  mapTcgdexCardToSourcePrinting,
  pricesFor,
  strictTcgdexFetch,
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
    expect(mapped.imageUrls).toEqual([
      "https://assets.tcgdex.net/en/sv/sv06.5/001/high.webp",
      "https://assets.tcgdex.net/en/sv/sv06.5/001/high.png",
      "https://assets.tcgdex.net/en/sv/sv06.5/001/low.webp",
      "https://assets.tcgdex.net/en/sv/sv06.5/001/low.png",
    ]);
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
    expect(mapped.imageUrls).toBeUndefined();
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

describe("finishesFor", () => {
  it("inherits the set's default variants when the card has none of its own", () => {
    expect(finishesFor(undefined, { normal: true, reverse: true, holo: false })).toEqual([
      "NON_FOIL",
      "REVERSE_HOLO",
    ]);
  });

  it("lets card flags override the set's, field by field", () => {
    expect(
      finishesFor({ normal: false, holo: true }, { normal: true, reverse: true, holo: false }),
    ).toEqual(["HOLO", "REVERSE_HOLO"]);
  });

  it("ignores firstEdition (an edition, not a finish)", () => {
    expect(finishesFor({ firstEdition: true, holo: true }, undefined)).toEqual(["HOLO"]);
  });

  it("returns [] when neither card nor set says anything", () => {
    expect(finishesFor(undefined, undefined)).toEqual([]);
  });

  it("is threaded through mapTcgdexCardToSourcePrinting via the set variants", () => {
    const card: TcgdexCardInput = { id: "sv06.5-001", localId: "001", name: "Joltik" };

    expect(mapTcgdexCardToSourcePrinting(card, { normal: true, reverse: true }).finishes).toEqual([
      "NON_FOIL",
      "REVERSE_HOLO",
    ]);
    expect(mapTcgdexCardToSourcePrinting(card).finishes).toEqual([]);
  });
});

describe("pricesFor", () => {
  const cardmarket = {
    updated: "2026-09-27T00:00:00.000Z",
    unit: "EUR",
    avg: 0.25,
    low: 0.02,
    trend: 0.2,
    "avg-holo": 1.5,
    "low-holo": 0.5,
    "trend-holo": 1.2,
  };

  it("maps Cardmarket base -> NON_FOIL and -holo -> REVERSE_HOLO for a normal card", () => {
    const quotes = pricesFor({ cardmarket }, ["NON_FOIL", "REVERSE_HOLO"]);
    expect(quotes).toEqual([
      {
        finish: "NON_FOIL",
        source: "CARDMARKET",
        currency: "EUR",
        low: 2,
        mid: 25,
        trend: 20,
        observedAt: cardmarket.updated,
      },
      {
        finish: "REVERSE_HOLO",
        source: "CARDMARKET",
        currency: "EUR",
        low: 50,
        mid: 150,
        trend: 120,
        observedAt: cardmarket.updated,
      },
    ]);
  });

  it("gives the Cardmarket base price to HOLO for a holo-only card", () => {
    const quotes = pricesFor({ cardmarket }, ["HOLO", "REVERSE_HOLO"]);
    expect(quotes.map((q) => [q.finish, q.trend])).toEqual([
      ["HOLO", 20],
      ["REVERSE_HOLO", 120],
    ]);
  });

  it("maps TCGplayer sub-types onto finishes and drops ones the card isn't printed in", () => {
    const quotes = pricesFor(
      {
        tcgplayer: {
          unit: "USD",
          updated: "2026-09-26",
          normal: { lowPrice: 0.05, midPrice: 0.2, marketPrice: 0.15 },
          "reverse-holofoil": { lowPrice: 0.5, midPrice: 1, marketPrice: 0.9 },
          holofoil: { lowPrice: 9, midPrice: 10, marketPrice: 11 },
        },
      },
      ["NON_FOIL", "REVERSE_HOLO"],
    );
    expect(quotes.map((q) => [q.source, q.finish, q.currency, q.market])).toEqual([
      ["TCGPLAYER", "NON_FOIL", "USD", 15],
      ["TCGPLAYER", "REVERSE_HOLO", "USD", 90],
    ]);
  });

  it("drops quotes with no usable amount and tolerates missing pricing", () => {
    expect(pricesFor({ cardmarket: { avg: null, low: 0, trend: null } }, ["NON_FOIL"])).toEqual([]);
    expect(pricesFor(undefined, ["NON_FOIL"])).toEqual([]);
    expect(pricesFor({ cardmarket: null, tcgplayer: null }, ["NON_FOIL"])).toEqual([]);
  });
});

describe("strictTcgdexFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes 200 and 404 through (404 = genuinely not found)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    expect((await strictTcgdexFetch("https://api.tcgdex.net/v2/en/sets/nope")).status).toBe(404);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    expect((await strictTcgdexFetch("https://api.tcgdex.net/v2/en/sets")).status).toBe(200);
  });

  it("throws on anything else instead of pretending the set doesn't exist", async () => {
    vi.stubGlobal("fetch", async () => new Response("denied", { status: 403 }));
    await expect(strictTcgdexFetch("https://api.tcgdex.net/v2/en/sets/sv01")).rejects.toThrow(
      /HTTP 403/,
    );
  });
});
