import { describe, expect, it, vi } from "vitest";
import {
  YgoprodeckAdapter,
  mapYgoprodeckSet,
  mapYgoprodeckSetSummary,
  withUniqueSetCodes,
  ygoprodeckPrintingsForSet,
  type YgoprodeckCard,
  type YgoprodeckSet,
} from "./ygoprodeck";

describe("mapYgoprodeckSet / mapYgoprodeckSetSummary", () => {
  const set: YgoprodeckSet = {
    set_name: "Legend of Blue Eyes White Dragon",
    set_code: "LOB",
    num_of_cards: 126,
    tcg_date: "2002-03-08",
  };

  it("maps a cardsets.php row onto SourceSet", () => {
    expect(mapYgoprodeckSet(set)).toEqual({
      code: "LOB",
      name: "Legend of Blue Eyes White Dragon",
      releaseDate: "2002-03-08",
      printedTotal: 126,
      totalCards: 126,
    });
  });

  it("maps a cardsets.php row onto SourceSetSummary", () => {
    expect(mapYgoprodeckSetSummary(set)).toEqual({
      code: "LOB",
      name: "Legend of Blue Eyes White Dragon",
      totalCards: 126,
    });
  });
});

describe("ygoprodeckPrintingsForSet", () => {
  const dragon: YgoprodeckCard = {
    id: 89631139,
    name: "Blue-Eyes White Dragon",
    type: "Normal Monster",
    desc: "This legendary dragon is a powerful engine of destruction.",
    race: "Dragon",
    attribute: "LIGHT",
    atk: 3000,
    def: 2500,
    level: 8,
    card_sets: [
      {
        set_name: "Legend of Blue Eyes White Dragon",
        set_code: "LOB-001",
        set_rarity: "Ultra Rare",
        set_price: "5.00",
      },
      {
        set_name: "Legendary Collection",
        set_code: "LCYW-EN003",
        set_rarity: "Secret Rare",
        set_price: "8.00",
      },
    ],
    card_images: [
      {
        id: 89631139,
        image_url: "https://images.ygoprodeck.com/images/cards/89631139.jpg",
        image_url_small: "https://images.ygoprodeck.com/images/cards_small/89631139.jpg",
      },
    ],
  };

  it("maps one printing per card_sets entry belonging to the given set", () => {
    const printings = ygoprodeckPrintingsForSet(dragon, "Legend of Blue Eyes White Dragon");

    expect(printings).toHaveLength(1);
    expect(printings[0]).toEqual({
      externalCardId: "89631139-LOB-001",
      cardName: "Blue-Eyes White Dragon",
      cardType: "Normal Monster",
      subtypes: [],
      collectorNumber: "LOB-001",
      rarityName: "Ultra Rare",
      imageUrls: ["https://images.ygoprodeck.com/images/cards/89631139.jpg"],
      attributes: {
        effect: "This legendary dragon is a powerful engine of destruction.",
        race: "Dragon",
        attribute: "LIGHT",
        atk: 3000,
        def: 2500,
        level: 8,
      },
    });
  });

  it("returns [] for a card with no entry in the given set", () => {
    expect(ygoprodeckPrintingsForSet(dragon, "Some Other Set")).toEqual([]);
  });

  it("maps a card printed twice in the same set to two printings (different rarities)", () => {
    const reprinted: YgoprodeckCard = {
      ...dragon,
      card_sets: [
        { set_name: "Ghosts From the Past", set_code: "GFTP-EN001", set_rarity: "Ghost Rare" },
        { set_name: "Ghosts From the Past", set_code: "GFTP-EN050", set_rarity: "Ultra Rare" },
      ],
    };

    expect(ygoprodeckPrintingsForSet(reprinted, "Ghosts From the Past")).toHaveLength(2);
  });
});

function fetchJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("YgoprodeckAdapter", () => {
  const sets: YgoprodeckSet[] = [
    {
      set_name: "Legend of Blue Eyes White Dragon",
      set_code: "LOB",
      num_of_cards: 126,
      tcg_date: "2002-03-08",
    },
    { set_name: "Metal Raiders", set_code: "MRD", num_of_cards: 144, tcg_date: "2002-06-26" },
    { set_name: "Undated Promo", set_code: "UP", num_of_cards: 1 },
  ];
  const cardinfo = {
    data: [
      {
        id: 89631139,
        name: "Blue-Eyes White Dragon",
        type: "Normal Monster",
        desc: "This legendary dragon is a powerful engine of destruction.",
        race: "Dragon",
        attribute: "LIGHT",
        atk: 3000,
        def: 2500,
        level: 8,
        card_sets: [
          {
            set_name: "Legend of Blue Eyes White Dragon",
            set_code: "LOB-001",
            set_rarity: "Ultra Rare",
          },
        ],
        card_images: [
          { id: 89631139, image_url: "https://images.ygoprodeck.com/images/cards/89631139.jpg" },
        ],
      },
    ],
  };

  it("listSetSummaries sorts newest first and drops undated sets to the end", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);

    const summaries = await adapter.listSetSummaries();

    expect(summaries.map((s) => s.code)).toEqual(["MRD", "LOB", "UP"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches the set list across calls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);

    await adapter.getSet("LOB");
    await adapter.getSet("MRD");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("getSet returns null for an unknown code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);

    expect(await adapter.getSet("NOPE")).toBeNull();
  });

  it("listPrintings resolves the set's display name and filters cards to it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fetchJsonResponse(sets))
      .mockResolvedValueOnce(fetchJsonResponse(cardinfo));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);

    const printings = await adapter.listPrintings("LOB");

    expect(printings).toHaveLength(1);
    expect(printings[0]?.collectorNumber).toBe("LOB-001");
    const secondCall = fetchImpl.mock.calls[1]?.[0] as string;
    expect(secondCall).toContain(encodeURIComponent("Legend of Blue Eyes White Dragon"));
  });

  it("listPrintings returns [] for a set the source has no cards for (HTTP 400)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fetchJsonResponse(sets))
      .mockResolvedValueOnce(fetchJsonResponse({ error: "No card matching" }, 400));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);

    expect(await adapter.listPrintings("LOB")).toEqual([]);
  });

  it("listPrintings returns [] for an unknown set code without a network call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);

    expect(await adapter.listPrintings("NOPE")).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on an unexpected HTTP status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse({}, 503));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);

    await expect(adapter.listSetSummaries()).rejects.toThrow(/HTTP 503/);
  });
});

describe("withUniqueSetCodes", () => {
  // Real rows from cardsets.php: several sets share the code ABPF.
  const sets: YgoprodeckSet[] = [
    { set_name: "Absolute Powerforce: Special Edition", set_code: "ABPF", num_of_cards: 3 },
    { set_name: "Absolute Powerforce", set_code: "ABPF", num_of_cards: 104 },
    {
      set_name: "Absolute Powerforce Sneak Peek Participation Card",
      set_code: "ABPF",
      num_of_cards: 1,
    },
    { set_name: "Legend of Blue Eyes White Dragon", set_code: "LOB", num_of_cards: 126 },
  ];

  it("keeps the main set's plain code and disambiguates the rest, deterministically", () => {
    const codes = withUniqueSetCodes(sets).map((s) => s.code);
    expect(codes).toEqual([
      "ABPF~absolute-powerforce-special-edition",
      "ABPF",
      "ABPF~absolute-powerforce-sneak-peek-participation-card",
      "LOB",
    ]);
    expect(new Set(codes).size).toBe(codes.length);
    // Order of the source list doesn't matter.
    expect(withUniqueSetCodes([...sets].reverse()).map((s) => s.code)).toEqual(
      [...codes].reverse(),
    );
  });

  it("the adapter lists and resolves sets by the unique code", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(sets), { status: 200 }));
    const adapter = new YgoprodeckAdapter(fetchImpl as unknown as typeof fetch);
    const summaries = await adapter.listSetSummaries();
    expect(new Set(summaries.map((s) => s.code)).size).toBe(4);
    expect((await adapter.getSet("ABPF"))?.name).toBe("Absolute Powerforce");
    expect((await adapter.getSet("ABPF~absolute-powerforce-special-edition"))?.totalCards).toBe(3);
  });
});
