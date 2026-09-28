import { describe, expect, it, vi } from "vitest";
import {
  OptcgAdapter,
  mapOptcgCardToSourcePrinting,
  mapOptcgSet,
  mapOptcgSetSummary,
  type OptcgCard,
  type OptcgSet,
} from "./optcg";

describe("mapOptcgSet / mapOptcgSetSummary", () => {
  const set: OptcgSet = { set_name: "ROMANCE DAWN [OP01]", set_id: "OP01" };

  it("maps an allSets/ row onto SourceSet", () => {
    expect(mapOptcgSet(set)).toEqual({ code: "OP01", name: "ROMANCE DAWN [OP01]" });
  });

  it("maps an allSets/ row onto SourceSetSummary", () => {
    expect(mapOptcgSetSummary(set)).toEqual({ code: "OP01", name: "ROMANCE DAWN [OP01]" });
  });
});

describe("mapOptcgCardToSourcePrinting", () => {
  const luffy: OptcgCard = {
    card_name: "Monkey.D.Luffy",
    set_name: "ROMANCE DAWN [OP01]",
    card_text: "[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power.",
    set_id: "OP01",
    rarity: "L",
    card_set_id: "OP01-001",
    card_color: "Red",
    card_type: "LEADER",
    life: "5",
    card_cost: null,
    card_power: "5000",
    sub_types: "Supernovas/Straw Hat Crew",
    counter_amount: null,
    attribute: "Strike",
    card_image: "https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001.png",
  };

  it("maps a card onto SourcePrinting", () => {
    expect(mapOptcgCardToSourcePrinting(luffy)).toEqual({
      externalCardId: "OP01-001",
      cardName: "Monkey.D.Luffy",
      cardType: "LEADER",
      subtypes: ["Supernovas", "Straw Hat Crew"],
      collectorNumber: "OP01-001",
      rarityName: "L",
      imageUrls: ["https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001.png"],
      attributes: {
        effect: "[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power.",
        color: "Red",
        life: "5",
        power: "5000",
        attribute: "Strike",
      },
    });
  });

  it("tolerates missing optional fields", () => {
    const bare: OptcgCard = {
      card_name: "Buggy",
      set_name: "ROMANCE DAWN [OP01]",
      set_id: "OP01",
      card_set_id: "OP01-005",
      card_type: "CHARACTER",
    };

    const mapped = mapOptcgCardToSourcePrinting(bare);

    expect(mapped.subtypes).toEqual([]);
    expect(mapped.rarityName).toBeUndefined();
    expect(mapped.imageUrls).toBeUndefined();
    expect(mapped.attributes).toEqual({});
  });
});

function fetchJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("OptcgAdapter", () => {
  const sets: OptcgSet[] = [
    { set_name: "ROMANCE DAWN [OP01]", set_id: "OP01" },
    { set_name: "PARAMOUNT WAR [OP02]", set_id: "OP02" },
  ];
  const op01Cards: OptcgCard[] = [
    {
      card_name: "Monkey.D.Luffy",
      set_name: "ROMANCE DAWN [OP01]",
      set_id: "OP01",
      card_set_id: "OP01-001",
      card_type: "LEADER",
      rarity: "L",
    },
  ];

  it("listSetSummaries returns every set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new OptcgAdapter(fetchImpl as unknown as typeof fetch);

    expect(await adapter.listSetSummaries()).toEqual([
      { code: "OP01", name: "ROMANCE DAWN [OP01]" },
      { code: "OP02", name: "PARAMOUNT WAR [OP02]" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches the set list across calls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new OptcgAdapter(fetchImpl as unknown as typeof fetch);

    await adapter.getSet("OP01");
    await adapter.getSet("OP02");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("getSet returns null for an unknown code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new OptcgAdapter(fetchImpl as unknown as typeof fetch);

    expect(await adapter.getSet("NOPE")).toBeNull();
  });

  it("listPrintings fetches the set's cards directly by code", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fetchJsonResponse(sets))
      .mockResolvedValueOnce(fetchJsonResponse(op01Cards));
    const adapter = new OptcgAdapter(fetchImpl as unknown as typeof fetch);

    const printings = await adapter.listPrintings("OP01");

    expect(printings).toHaveLength(1);
    expect(printings[0]?.collectorNumber).toBe("OP01-001");
    const secondCall = fetchImpl.mock.calls[1]?.[0] as string;
    expect(secondCall).toBe("https://www.optcgapi.com/api/sets/OP01/");
  });

  it("listPrintings returns [] for an unknown set code without a network call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse(sets));
    const adapter = new OptcgAdapter(fetchImpl as unknown as typeof fetch);

    expect(await adapter.listPrintings("NOPE")).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on an unexpected HTTP status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchJsonResponse({}, 503));
    const adapter = new OptcgAdapter(fetchImpl as unknown as typeof fetch);

    await expect(adapter.listSetSummaries()).rejects.toThrow(/HTTP 503/);
  });
});
