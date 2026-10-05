import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CardTraderProvider,
  bareSetCode,
  cardTraderObservations,
  scoreExpansion,
  lowestAverage,
  matchBlueprint,
  type CardTraderBlueprint,
  type CardTraderProduct,
} from "./cardtrader";
import { EbayProvider, ebayObservations, parseEbaySearch } from "./ebay";
import { ebayQueryFor, filterListings } from "./ebay-filter";
import { AuthError, RateLimitedError, parseRetryAfter, requestJson } from "./http";
import { normalizeName, normalizeNumber, scoreCardMatch, scoreSetMatch } from "./matching";
import { TcgcsvPriceClient } from "./tcgcsv-prices";
import {
  TcgdexMarketProvider,
  TcgdexPriceClient,
  quoteToObservations,
  tcgdexCardId,
  tcgdexMarketIdsFor,
} from "./tcgdex-prices";
import type { PricedCard } from "./types";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", name), "utf8")) as unknown;

const joltik: PricedCard = {
  variantId: "v-joltik",
  game: "pokemon",
  cardName: "Joltik",
  setCode: "sv06.5",
  setName: "Shrouded Fable",
  collectorNumber: "001/064",
  printedTotal: 64,
  finish: "NON_FOIL",
  printingFinishes: ["NON_FOIL", "REVERSE_HOLO"],
  languageCode: "en",
  externalIds: { "tcgdex-pokemon": "sv06.5-001" },
};

/** fetch stub answering by URL substring, recording calls. */
function routes(table: Array<[string | RegExp, () => Response]>) {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const hit = table.find(([pattern]) =>
      typeof pattern === "string" ? url.includes(pattern) : pattern.test(url),
    );
    return hit ? hit[1]() : new Response("not found", { status: 404 });
  });
}
const json =
  (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

describe("matching rules", () => {
  it("normalizes names and collector numbers", () => {
    expect(normalizeName("Pokémon GO: Pikachu & Zekrom-GX")).toBe(
      "pokemon go pikachu and zekrom gx",
    );
    expect(normalizeName("Team Rocket's Mewtwo ex")).toBe("team rockets mewtwo ex");
    expect(normalizeNumber("001/064")).toBe("1");
    expect(normalizeNumber("TG01/TG30")).toBe("tg1");
    expect(normalizeNumber("SVP 123")).toBe("svp123");
    expect(normalizeNumber("GG05")).toBe("gg5");
  });

  it("never matches on name alone", () => {
    expect(
      scoreCardMatch({ name: "Pikachu", number: "025/165" }, { name: "Pikachu", number: "026" })
        .score,
    ).toBe(0);
    expect(
      scoreCardMatch({ name: "Pikachu", number: "025/165" }, { name: "Pikachu", number: null })
        .score,
    ).toBe(0);
  });

  it("scores number + name highest, number with a different name low", () => {
    expect(
      scoreCardMatch({ name: "Joltik", number: "001/064" }, { name: "Joltik", number: "1" }).score,
    ).toBe(1);
    expect(
      scoreCardMatch(
        { name: "Charizard ex", number: "199/165" },
        { name: "Charizard ex (SIR)", number: "199" },
      ).score,
    ).toBe(0.85);
    expect(
      scoreCardMatch({ name: "Joltik", number: "001/064" }, { name: "Galvantula", number: "001" })
        .score,
    ).toBe(0.5);
  });

  it("matches sets by name first, then code", () => {
    expect(
      scoreSetMatch({ code: "sv06.5", name: "Shrouded Fable" }, { name: "Shrouded Fable" }).score,
    ).toBe(1);
    expect(
      scoreSetMatch({ code: "sv06.5", name: "Shrouded Fable" }, { code: "SV06.5", name: "SFA" })
        .score,
    ).toBe(0.95);
    expect(
      scoreSetMatch({ code: "sv06.5", name: "Shrouded Fable" }, { name: "Twilight Masquerade" })
        .score,
    ).toBe(0);
  });
});

describe("http helpers", () => {
  it("parses Retry-After seconds and dates, capped at an hour", () => {
    expect(parseRetryAfter("30", 1)).toBe(30_000);
    expect(parseRetryAfter("99999", 1)).toBe(3_600_000);
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString(), 1)).toBeGreaterThan(5_000);
    expect(parseRetryAfter(null, 1234)).toBe(1234);
  });

  it("maps 429 to a rate-limit error with the server's wait, and 401 to a fatal auth error", async () => {
    const limited = routes([["x", json({}, 429, { "retry-after": "12" })]]);
    const err = await requestJson(
      "https://api.example/x",
      {},
      { provider: "p", fetch: limited as never },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(12_000);

    const denied = routes([["x", json({ error: "bad token" }, 401)]]);
    const auth = await requestJson(
      "https://api.example/x",
      {},
      { provider: "p", fetch: denied as never },
    ).catch((e: unknown) => e);
    expect(auth).toBeInstanceOf(AuthError);
    expect(auth).toMatchObject({ retryable: false, fatal: true });
  });
});

describe("Cardmarket / TCGplayer via TCGdex", () => {
  const fetchImpl = routes([["/cards/sv06.5-001", json(fixture("tcgdex-card-sv06.5-001.json"))]]);
  const client = new TcgdexPriceClient({ fetch: fetchImpl as never });
  const cardmarket = new TcgdexMarketProvider("cardmarket", client);
  const tcgplayer = new TcgdexMarketProvider("tcgplayer", client);

  it("labels each Cardmarket number with what it is, in EUR cents, dated by TCGdex", async () => {
    const mapping = await cardmarket.resolveMapping(joltik);
    expect(mapping).toMatchObject({ externalId: "772001", status: "matched", confidence: 1 });
    const obs = await cardmarket.fetchPrices(joltik);
    expect(obs.map((o) => [o.kind, o.amount, o.currency])).toEqual([
      ["trend", 18, "EUR"],
      ["market_average", 21, "EUR"],
      ["lowest_listing", 2, "EUR"],
    ]);
    expect(obs[0]!.observedAt.toISOString()).toBe("2026-09-27T01:02:03.000Z");
    expect(obs[0]!.payloadHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("uses Cardmarket's -holo columns for the reverse holo variant", async () => {
    const obs = await cardmarket.fetchPrices({ ...joltik, finish: "REVERSE_HOLO" });
    expect(obs.find((o) => o.kind === "trend")!.amount).toBe(48);
  });

  it("maps TCGplayer's market/mid/low to market_average/asking/lowest_listing in USD", async () => {
    const mapping = await tcgplayer.resolveMapping(joltik);
    expect(mapping).toMatchObject({
      externalId: "551234",
      url: "https://www.tcgplayer.com/product/551234",
    });
    const obs = await tcgplayer.fetchPrices(joltik);
    expect(obs.map((o) => [o.kind, o.amount, o.currency])).toEqual([
      ["market_average", 12, "USD"],
      ["asking", 15, "USD"],
      ["lowest_listing", 5, "USD"],
    ]);
  });

  it("fetches the card once for both providers", () => {
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports not_found for a finish the marketplace doesn't price", async () => {
    const holo = await tcgplayer.resolveMapping({
      ...joltik,
      finish: "HOLO",
      printingFinishes: ["NON_FOIL", "HOLO"],
    });
    expect(holo.status).toBe("not_found");
  });

  it("quoteToObservations drops fields the source left empty", () => {
    const obs = quoteToObservations({
      finish: "NON_FOIL",
      source: "CARDMARKET",
      currency: "EUR",
      trend: 100,
    });
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ kind: "trend", amount: 100 });
  });
});

describe("CardTrader", () => {
  const blueprints = fixture("cardtrader-blueprints-4101.json") as CardTraderBlueprint[];
  const products = (
    fixture("cardtrader-products-900001.json") as Record<string, CardTraderProduct[]>
  )["900001"]!;

  it("matches a blueprint by Cardmarket id when both sides have it", () => {
    const m = matchBlueprint({ ...joltik, externalIds: { cardmarket: "772001" } }, blueprints, 0.7);
    expect(m).toMatchObject({ confidence: 1, notes: "Same Cardmarket product id" });
    expect(m.blueprint!.id).toBe(900001);
  });

  it("otherwise matches by collector number + name, scaled by how sure the set match is", () => {
    const m = matchBlueprint({ ...joltik, externalIds: {} }, blueprints, 0.7);
    expect(m.blueprint!.id).toBe(900001);
    expect(m.confidence).toBe(0.7);
  });

  it("never picks a blueprint on name alone", () => {
    const m = matchBlueprint(
      { ...joltik, collectorNumber: "050/064", externalIds: {} },
      blueprints,
      1,
    );
    expect(m.blueprint).toBeNull();
  });

  it("reports the cheapest raw listing per condition, dropping graded, other languages, other finish and sold-out", () => {
    const all = cardTraderObservations(products, joltik);
    // One fetch, one observation set per listing language: the Japanese copy is its own number.
    const obs = all.filter((o) => o.languageCode === "en" && o.kind === "lowest_listing");
    const byCondition = Object.fromEntries(obs.map((o) => [o.condition, o]));
    expect(byCondition.NEAR_MINT).toMatchObject({
      kind: "lowest_listing",
      amount: 9,
      currency: "EUR",
      listingCount: 2,
      languageCode: "en",
    });
    expect(byCondition.LIGHTLY_PLAYED).toMatchObject({ amount: 5, listingCount: 1 });
    expect(obs).toHaveLength(2);
    expect(all.filter((o) => o.languageCode === "ja")).toEqual([
      expect.objectContaining({ amount: 3, condition: "NEAR_MINT" }),
    ]);
  });

  it("also reports the top of the cheapest-few range (5th cheapest, or the dearest of fewer) per group", () => {
    const listing = (cents: number, id: number): CardTraderProduct => ({
      id,
      blueprint_id: 1,
      quantity: 1,
      price: { cents, currency: "EUR" },
      graded: false,
      properties_hash: { condition: "Near Mint", pokemon_language: "it", pokemon_reverse: false },
    });
    const six = [6000, 6300, 6400, 6400, 6500, 9900].map((c, i) => listing(c, i + 1));
    const obs = cardTraderObservations(six, joltik).filter((o) => o.languageCode === "it");
    expect(obs.find((o) => o.kind === "lowest_listing")?.amount).toBe(6000);
    expect(obs.find((o) => o.kind === "lowest_5th")?.amount).toBe(6500);
    // A single listing, or all at one price: no range.
    expect(cardTraderObservations([listing(6000, 1)], joltik).map((o) => o.kind)).toEqual(["lowest_listing"]);
    expect(cardTraderObservations([listing(6000, 1), listing(6000, 2)], joltik).map((o) => o.kind)).toEqual(["lowest_listing"]);
  });

  it("a cheap German listing gets its own observation and never lowers the English one", () => {
    const german: CardTraderProduct = {
      id: 99,
      blueprint_id: 900001,
      quantity: 1,
      price: { cents: 1, currency: "EUR" },
      graded: false,
      properties_hash: { condition: "Near Mint", pokemon_language: "de", pokemon_reverse: false },
    };
    const obs = cardTraderObservations([...products, german], joltik);
    const nm = (lang: string) =>
      obs.find((o) => o.languageCode === lang && o.condition === "NEAR_MINT")?.amount;
    expect(nm("de")).toBe(1);
    expect(nm("en")).toBe(9);
  });

  it("only counts reverse holo listings for the reverse holo variant", () => {
    const obs = cardTraderObservations(products, { ...joltik, finish: "REVERSE_HOLO" });
    expect(obs).toEqual([
      expect.objectContaining({
        amount: 45,
        condition: "NEAR_MINT",
        listingCount: 1,
        languageCode: "en",
      }),
    ]);
  });

  it("returns nothing for reverse holo when CardTrader doesn't say which listings are reverse", () => {
    const noFlag = products.map((p) => ({ ...p, properties_hash: { condition: "Near Mint" } }));
    expect(cardTraderObservations(noFlag, { ...joltik, finish: "REVERSE_HOLO" })).toEqual([]);
  });

  it("resolves game -> expansion -> blueprint and fetches listings with the bearer token", async () => {
    const fetchImpl = routes([
      ["/games", json(fixture("cardtrader-games.json"))],
      ["/expansions", json(fixture("cardtrader-expansions.json"))],
      ["/blueprints/export?expansion_id=4101", json(blueprints)],
      [
        "/marketplace/products?blueprint_id=900001",
        json(fixture("cardtrader-products-900001.json")),
      ],
    ]);
    const provider = new CardTraderProvider({ token: "secret-token", fetch: fetchImpl as never });
    const mapping = await provider.resolveMapping(joltik);
    expect(mapping).toMatchObject({ externalId: "900001", status: "matched", confidence: 1 });
    const obs = await provider.fetchPrices(joltik, mapping!);
    expect(obs.find((o) => o.condition === "NEAR_MINT")!.amount).toBe(9);
    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("does nothing without a token", async () => {
    const provider = new CardTraderProvider({ token: null });
    expect(provider.isConfigured()).toBe(false);
    expect(await provider.resolveMapping(joltik)).toBeNull();
    expect(await provider.testConnection()).toEqual({ ok: false, message: "API token not set" });
  });
});

describe("eBay listing filter rules", () => {
  const listings = parseEbaySearch(fixture("ebay-search-joltik.json"));
  const ctx = {
    cardName: "Joltik",
    collectorNumber: "001/064",
    printedTotal: 64,
    finish: "NON_FOIL",
    languageCode: "en",
  };

  it("parses prices into minor units", () => {
    expect(listings[0]).toMatchObject({ itemId: "v1|1|0", price: 99, currency: "USD" });
  });

  it("rejects each kind of junk with the rule that caught it", () => {
    const { accepted, rejected } = filterListings(listings, ctx);
    expect(accepted.map((l) => l.itemId)).toEqual(["v1|1|0", "v1|2|0", "v1|3|0"]);
    expect(Object.fromEntries(rejected.map((r) => [r.listing.itemId, r.rule]))).toEqual({
      "v1|4|0": "wrong-finish",
      "v1|5|0": "graded",
      "v1|6|0": "lot-or-bundle",
      "v1|7|0": "wrong-language",
      "v1|8|0": "wrong-number",
      "v1|9|0": "sealed-or-digital",
      "v1|10|0": "auction",
      "v1|11|0": "proxy-or-fake",
    });
  });

  it("keeps 'pack fresh' singles but drops packs", () => {
    const l = (title: string) => ({
      itemId: title,
      title,
      price: 100,
      currency: "USD",
      buyingOptions: ["FIXED_PRICE"],
    });
    const { accepted } = filterListings(
      [l("Joltik 001/064 pack fresh"), l("Joltik 001/064 booster pack")],
      ctx,
    );
    expect(accepted.map((a) => a.title)).toEqual(["Joltik 001/064 pack fresh"]);
  });

  it("only keeps reverse holo listings for the reverse holo variant", () => {
    const { accepted } = filterListings(listings, { ...ctx, finish: "REVERSE_HOLO" });
    expect(accepted.map((l) => l.itemId)).toEqual(["v1|4|0"]);
  });

  it("requires every word of the name and the exact number", () => {
    const l = (title: string) => ({ itemId: title, title, price: 100, currency: "USD" });
    const charizard = {
      ...ctx,
      cardName: "Charizard ex",
      collectorNumber: "199/165",
      printedTotal: 165,
    };
    const { accepted, rejected } = filterListings(
      [
        l("Charizard ex 199/165 SIR 151"),
        l("Charizard 199/165"),
        l("Charizard ex 19/165"),
        l("Charizard ex 1199/165"),
      ],
      charizard,
    );
    expect(accepted.map((a) => a.title)).toEqual(["Charizard ex 199/165 SIR 151"]);
    expect(rejected.map((r) => r.rule)).toEqual(["wrong-name", "wrong-number", "wrong-number"]);
  });

  it("drops price outliers once there are enough listings", () => {
    const l = (id: string, price: number) => ({
      itemId: id,
      title: "Joltik 001/064",
      price,
      currency: "USD",
    });
    const { accepted, rejected } = filterListings(
      [l("a", 100), l("b", 110), l("c", 90), l("d", 105), l("e", 5000), l("f", 1)],
      ctx,
    );
    expect(accepted.map((a) => a.itemId)).toEqual(["a", "b", "c", "d"]);
    expect(rejected.map((r) => r.rule)).toEqual(["price-outlier", "price-outlier"]);
  });

  it("summarizes surviving listings as asking (median) and lowest listing, never as sold", () => {
    const obs = ebayObservations(filterListings(listings, ctx).accepted);
    expect(obs.map((o) => [o.kind, o.amount, o.listingCount])).toEqual([
      ["asking", 99, 3],
      ["lowest_listing", 50, 3],
      ["lowest_5th", 125, 3],
    ]);
    expect(obs.some((o) => o.kind === "sold")).toBe(false);
  });
});

describe("EbayProvider", () => {
  it("gets an app token with client credentials, then searches with it", async () => {
    const fetchImpl = routes([
      ["/identity/v1/oauth2/token", json({ access_token: "app-token", expires_in: 7200 })],
      ["/buy/browse/v1/item_summary/search", json(fixture("ebay-search-joltik.json"))],
    ]);
    const provider = new EbayProvider({
      clientId: "id",
      clientSecret: "secret",
      marketplaceId: "EBAY_DE",
      fetch: fetchImpl as never,
    });
    const mapping = await provider.resolveMapping(joltik);
    expect(mapping!.query).toBe("Joltik 001/064");
    const obs = await provider.fetchPrices(joltik, mapping!);
    expect(obs.map((o) => o.kind)).toEqual(["asking", "lowest_listing", "lowest_5th"]);

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect((tokenInit.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("id:secret").toString("base64")}`,
    );
    expect(String(tokenInit.body)).toContain("grant_type=client_credentials");
    const [searchUrl, searchInit] = fetchImpl.mock.calls[1]! as unknown as [string, RequestInit];
    expect(searchUrl).toContain("category_ids=183454");
    expect(searchUrl).toContain("buyingOptions%3A%7BFIXED_PRICE%7D");
    expect((searchInit.headers as Record<string, string>)["X-EBAY-C-MARKETPLACE-ID"]).toBe(
      "EBAY_DE",
    );

    // The token is reused.
    await provider.fetchPrices(joltik, mapping!);
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes("oauth2")).length).toBe(1);
  });

  it("turns rejected credentials into a clear, fatal error", async () => {
    const fetchImpl = routes([["/oauth2/token", json({ error: "invalid_client" }, 401)]]);
    const provider = new EbayProvider({
      clientId: "id",
      clientSecret: "wrong",
      fetch: fetchImpl as never,
    });
    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/invalid or expired credentials/);
  });

  it("uses the sandbox hosts when asked", async () => {
    const fetchImpl = routes([["/oauth2/token", json({ access_token: "t" })]]);
    const provider = new EbayProvider({
      clientId: "a",
      clientSecret: "b",
      environment: "sandbox",
      fetch: fetchImpl as never,
    });
    expect((await provider.testConnection()).ok).toBe(true);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("api.sandbox.ebay.com");
  });
});

describe("eBay by language", () => {
  const ctx = {
    cardName: "Joltik",
    collectorNumber: "001/064",
    printedTotal: 64,
    finish: "NON_FOIL",
    languageCode: "en",
  };
  const mk = (title: string, price = 100) => ({
    itemId: title,
    title,
    price,
    currency: "EUR",
  });

  it("English: titles naming another language are dropped, untagged titles count", () => {
    const { accepted } = filterListings(
      [
        mk("Joltik 001/064 Pokemon card"),
        mk("Joltik 001/064 Deutsch", 10),
        mk("Joltik 001/064 German", 10),
      ],
      ctx,
    );
    expect(accepted.map((l) => l.title)).toEqual(["Joltik 001/064 Pokemon card"]);
  });

  it("another language: only titles that name it count", () => {
    const { accepted } = filterListings(
      [
        mk("Joltik 001/064 Pokemon card"),
        mk("Joltik 001/064 Deutsch", 10),
        mk("Joltik 001/064 French", 10),
      ],
      { ...ctx, languageCode: "de" },
    );
    expect(accepted.map((l) => l.title)).toEqual(["Joltik 001/064 Deutsch"]);
  });

  it("observations carry the language, and the query asks for it", () => {
    const obs = ebayObservations([mk("Joltik 001/064 Deutsch", 10)], { languageCode: "de" });
    expect(obs.every((o) => o.languageCode === "de")).toBe(true);
    expect(ebayQueryFor({ ...ctx, languageCode: "de" })).toBe("Joltik 001/064 german");
    expect(ebayQueryFor(ctx)).toBe("Joltik 001/064");
  });
});

describe("scoreSetMatch: galleries filed in the parent expansion", () => {
  it("matches the parent expansion at a lower score", () => {
    const r = scoreSetMatch(
      { code: "swsh10tg", name: "Astral Radiance Trainer Gallery" },
      { name: "Astral Radiance" },
    );
    expect(r.score).toBe(0.6);
  });
  it("still rejects unrelated expansions", () => {
    expect(
      scoreSetMatch({ code: "swsh10tg", name: "Astral Radiance Trainer Gallery" }, { name: "Lost Origin" })
        .score,
    ).toBe(0);
  });
});

describe("tcgdexCardId", () => {
  const base = { setCode: "sv01", collectorNumber: "001/198", externalIds: {} as Record<string, string> };
  it("uses the id of the card's own language catalog", () => {
    expect(tcgdexCardId({ ...base, languageCode: "ja", externalIds: { "tcgdex-pokemon-ja": "SV1S-001" } } as never)).toBe("SV1S-001");
    expect(tcgdexCardId({ ...base, languageCode: "en", externalIds: { "tcgdex-pokemon": "sv01-001" } } as never)).toBe("sv01-001");
  });
  it("never guesses an English id for a Japanese card or a tcgcsv promo", () => {
    expect(tcgdexCardId({ ...base, languageCode: "ja" } as never)).toBeNull();
    // A tcgcsv promo is not a TCGdex card: it must never be looked up there.
    expect(tcgdexCardId({ ...base, languageCode: "en", externalIds: { "tcgdex-pokemon": "tcgcsv-162270" } } as never)).toBeNull();
    expect(tcgdexCardId({ ...base, setCode: "JP-sm-p", languageCode: "ja" } as never)).toBeNull();
    expect(tcgdexCardId({ ...base, languageCode: "en" } as never)).toBe("sv01-001");
  });
  it("does not guess an id for a gallery numbered outside the set's own total (30th Classic 001/30)", () => {
    const classic = { setCode: "30th", collectorNumber: "001/30", printedTotal: 128, languageCode: "en", externalIds: {} };
    expect(tcgdexCardId(classic as never)).toBeNull();
    expect(tcgdexCardId({ ...classic, externalIds: { "tcgdex-pokemon": "30th-c-001" } } as never)).toBe("30th-c-001");
    expect(tcgdexCardId({ ...classic, collectorNumber: "001/128" } as never)).toBe("30th-001");
  });
});

describe("tcgdexCardId for Trainer Gallery cards", () => {
  it("still guesses the gallery's own id (TG13/30 -> swsh9-TG13)", () => {
    const card = { setCode: "swsh9", collectorNumber: "TG13/30", printedTotal: 172, languageCode: "en", externalIds: {} };
    expect(tcgdexCardId(card as never)).toBe("swsh9-TG13");
  });
});

describe("CardTrader finds a card whose set our app names differently", () => {
  const starmie = {
    variantId: "v-starmie",
    game: "pokemon",
    cardName: "Starmie V",
    setCode: "it-swsh10tg",
    setName: "Lucentezza Siderale Galleria Allenatori",
    setNameAlt: "Astral Radiance Trainer Gallery",
    collectorNumber: "TG13/30",
    printedTotal: 30,
    finish: "HOLO",
    printingFinishes: ["HOLO"],
    languageCode: "it",
    priceLanguage: "it",
    externalIds: { cardmarket: "658890" },
  } as unknown as PricedCard;

  it("tries the English set name and finds the gallery card inside the parent expansion", async () => {
    const fetchImpl = routes([
      ["/games", json(fixture("cardtrader-games.json"))],
      [
        "/expansions",
        json([
          { id: 7001, game_id: 5, code: "swsh10", name: "Astral Radiance" },
          { id: 7002, game_id: 5, code: "swsh9", name: "Brilliant Stars" },
        ]),
      ],
      [
        "/blueprints/export?expansion_id=7001",
        json([
          { id: 212779, name: "Starmie V (Special Illustration Rare)", version: "TG13/TG30", card_market_ids: [658890], fixed_properties: { collector_number: "TG13/TG30" } },
        ]),
      ],
    ]);
    const provider = new CardTraderProvider({ token: "t", fetch: fetchImpl as never });
    expect(await provider.resolveMapping(starmie)).toMatchObject({
      externalId: "212779",
      status: "matched",
    });
  });

  it("without the English name it still finds the card by its Cardmarket id, in any expansion", async () => {
    const fetchImpl = routes([
      ["/games", json(fixture("cardtrader-games.json"))],
      ["/expansions", json([{ id: 7001, game_id: 5, code: "swsh10", name: "Astral Radiance" }])],
      [
        "/blueprints/export?expansion_id=7001",
        json([{ id: 212779, name: "Starmie V", card_market_ids: [658890], fixed_properties: { collector_number: "TG13/TG30" } }]),
      ],
    ]);
    const provider = new CardTraderProvider({ token: "t", fetch: fetchImpl as never });
    expect(await provider.resolveMapping({ ...starmie, setNameAlt: null })).toMatchObject({
      externalId: "212779",
      status: "matched",
      notes: 'Same Cardmarket product id, in "Astral Radiance"',
    });
  });

  it("with neither the English name nor a marketplace id it finds nothing", async () => {
    const fetchImpl = routes([
      ["/games", json(fixture("cardtrader-games.json"))],
      ["/expansions", json([{ id: 7001, game_id: 5, code: "swsh10", name: "Astral Radiance" }])],
    ]);
    const provider = new CardTraderProvider({ token: "t", fetch: fetchImpl as never });
    expect(
      await provider.resolveMapping({ ...starmie, setNameAlt: null, externalIds: {} }),
    ).toMatchObject({ status: "not_found" });
  });

  it("matches a short name of ours to a longer provider name", () => {
    expect(
      scoreSetMatch({ code: "swsh9", name: "Brilliant Stars" }, { name: "Brilliant Stars Trainer Gallery" }).score,
    ).toBe(0.6);
  });
});

describe("lowestAverage (the value of a copy from its cheapest listings)", () => {
  it("averages more listings when the market is deep and climbs gradually", () => {
    // Starmie V: 25 near-mint listings rising from 6899 to a few euro higher each.
    const gradual = Array.from({ length: 25 }, (_, i) => 6899 + i * 120);
    expect(lowestAverage(gradual)).toEqual({ amount: Math.round((6899 + 7019 + 7139 + 7259 + 7379) / 5), count: 5 });
  });
  it("averages only two with a handful of listings, and nothing with fewer than three", () => {
    expect(lowestAverage([6000, 6200, 6500, 7000])).toEqual({ amount: 6100, count: 2 });
    expect(lowestAverage([6000, 6200])).toBeNull();
    expect(lowestAverage([6000])).toBeNull();
  });
  it("stops where prices jump to another tier", () => {
    // Plenty of listings at ~60, then a jump to ~100: the 100s are not averaged in.
    const tiers = [6000, 6100, 6200, 10000, 10100, 10200, 10300, 10400];
    expect(lowestAverage(tiers)).toEqual({ amount: 6100, count: 3 });
  });
  it("leaves out one listing far below all the others", () => {
    expect(lowestAverage([2990, 6000, 6100, 6200, 6300])).toEqual({ amount: 6050, count: 2 });
  });
  it("is reported next to the cheapest listing, with how many it averaged", () => {
    const listing = (cents: number, id: number): CardTraderProduct => ({
      id,
      blueprint_id: 1,
      quantity: 1,
      price: { cents, currency: "EUR" },
      graded: false,
      properties_hash: { condition: "Near Mint", pokemon_language: "it", pokemon_reverse: false },
    });
    const obs = cardTraderObservations(
      [6899, 6900, 6958, 6964, 7064, 7554, 7594].map((c, i) => listing(c, i + 1)),
      joltik,
    ).filter((o) => o.languageCode === "it");
    expect(obs.find((o) => o.kind === "lowest_listing")?.amount).toBe(6899);
    expect(obs.find((o) => o.kind === "lowest_avg")).toMatchObject({ amount: 6919, listingCount: 3 });
  });
});

describe("lowestAverage tells a real market level from a random post", () => {
  it("skips a couple of cheap posts far below a supported level", () => {
    expect(lowestAverage([2990, 3000, 6000, 6100, 6200, 6300, 6400])).toEqual({ amount: 6100, count: 3 });
  });
  it("keeps to the floor level when a better-copies level (the 80s) sits above it", () => {
    const withTier = [6900, 6900, 6950, 8000, 8000, 8100, 8200, 8300];
    expect(lowestAverage(withTier)).toEqual({ amount: 6917, count: 3 });
  });
  it("does not count two listings as the floor when the market has a dozen", () => {
    // 2 listings at ~60, then a supported level of 10 at ~72: the average starts at the 72s.
    const thin = [6000, 6050, 7100, 7150, 7200, 7250, 7300, 7350, 7400, 7450, 7500, 7600];
    expect(lowestAverage(thin)).toEqual({ amount: 7175, count: 4 });
  });
  it("gives up when no price level has any support", () => {
    expect(lowestAverage([6000, 9000, 12000])).toBeNull();
  });
  it("never skips the cheap end of a scattered market to average dear listings", () => {
    // 7 near-mint copies: five scattered from €200 to €2,000, then two "for display" at ~€10k.
    // The five cheapest have no neighbour within 15%, the two dearest do: they are not the value.
    const scattered = [20064, 45000, 90000, 140000, 200064, 999999, 1006855];
    expect(lowestAverage(scattered)).toBeNull();
  });
  it("still skips a lone cheap post when a third of the market is not below the level", () => {
    expect(lowestAverage([1000, 5000, 9000, 9100, 9200])).toBeNull();
    expect(lowestAverage([1000, 9000, 9100, 9200, 9300])).toEqual({ amount: 9050, count: 2 });
  });
});

describe("eBay reports the same cheapest-listing figures", () => {
  it("adds the 5th cheapest and the average of the cheapest supported listings", () => {
    const listings = [6899, 6900, 6958, 6964, 7064, 7554, 7594].map((price, i) => ({
      itemId: String(i),
      title: "Starmie V",
      price,
      currency: "EUR",
    }));
    const obs = ebayObservations(listings as never, { languageCode: "it" });
    expect(obs.find((o) => o.kind === "lowest_listing")?.amount).toBe(6899);
    expect(obs.find((o) => o.kind === "lowest_5th")?.amount).toBe(7064);
    expect(obs.find((o) => o.kind === "lowest_avg")).toMatchObject({ amount: 6919, listingCount: 3 });
  });
});

describe("TCGplayer prices through tcgcsv when TCGdex has none", () => {
  const starmieEn = {
    variantId: "v-starmie-en",
    game: "pokemon",
    cardName: "Starmie V",
    setCode: "swsh10tg",
    setName: "Astral Radiance Trainer Gallery",
    collectorNumber: "TG13/30",
    printedTotal: 30,
    finish: "HOLO",
    printingFinishes: ["HOLO"],
    languageCode: "en",
    priceLanguage: "en",
    externalIds: { "tcgdex-pokemon": "swsh10tg-TG13" },
  } as unknown as PricedCard;

  const cardJson = {
    pricing: { cardmarket: null, tcgplayer: null },
    variants_detailed: [{ type: "holo", thirdParty: { cardmarket: 658890, tcgplayer: 272484 } }],
  };
  const tcgcsvRoutes = () =>
    routes([
      ["/v2/en/cards/swsh10tg-TG13", json(cardJson)],
      ["/v2/it/cards/swsh10tg-TG13", json(cardJson)],
      [
        "/tcgplayer/3/groups",
        json({ results: [{ groupId: 3068, name: "SWSH10: Astral Radiance Trainer Gallery", abbreviation: "SWSH10:TG" }] }),
      ],
      [
        "/tcgplayer/3/3068/prices",
        json({ results: [{ productId: 272484, lowPrice: 107, midPrice: 123.24, marketPrice: 117.6, subTypeName: "Holofoil" }] }),
      ],
    ]);

  it("finds the TCGplayer product TCGdex links and prices it from tcgcsv, in USD", async () => {
    const fetchImpl = tcgcsvRoutes();
    const provider = new TcgdexMarketProvider(
      "tcgplayer",
      new TcgdexPriceClient({ fetch: fetchImpl as never }),
      new TcgcsvPriceClient({ fetch: fetchImpl as never }),
    );
    const mapping = await provider.resolveMapping(starmieEn);
    expect(mapping).toMatchObject({ externalId: "272484", status: "matched" });
    const obs = await provider.fetchPrices(starmieEn);
    expect(obs.find((o) => o.kind === "market_average")).toMatchObject({ amount: 11760, currency: "USD" });
    expect(obs.find((o) => o.kind === "lowest_listing")?.amount).toBe(10700);
  });

  it("does not look for non-English cards: TCGplayer only sells English", async () => {
    const fetchImpl = tcgcsvRoutes();
    const provider = new TcgdexMarketProvider(
      "tcgplayer",
      new TcgdexPriceClient({ fetch: fetchImpl as never }),
      new TcgcsvPriceClient({ fetch: fetchImpl as never }),
    );
    const it = { ...starmieEn, languageCode: "it", externalIds: { "tcgdex-pokemon-it": "swsh10tg-TG13" } } as PricedCard;
    expect(await provider.fetchPrices(it)).toEqual([]);
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes("tcgcsv.com"))).toBe(false);
  });
});

describe("CardTrader: the right expansion and blueprint for every kind of card", () => {
  const games = ["/games", json(fixture("cardtrader-games.json"))] as [string, () => Response];
  const blackBolt = [
    { id: 4188, game_id: 5, code: "sv11b", name: "Black Bolt | sv11B" },
    { id: 4195, game_id: 5, code: "blk", name: "Black Bolt" },
    { id: 4223, game_id: 5, code: "m-sv11b", name: "Black Bolt | sv11B - Master Ball Reverse Holo" },
    { id: 4263, game_id: 5, code: "m-blk", name: "Black Bolt - Master Ball Reverse Holo" },
    { id: 4266, game_id: 5, code: "p-blk", name: "Black Bolt - Poké Ball Reverse Holo" },
    { id: 2069, game_id: 5, code: "sm9", name: "Tag Bolt" },
  ];
  const zekrom = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    name: "Zekrom ex",
    fixed_properties: { collector_number: "034/086" },
    ...extra,
  });
  const card = (over: Partial<PricedCard> = {}): PricedCard => ({
    ...joltik,
    variantId: "v-zekrom",
    cardName: "Zekrom ex",
    setCode: "sv10.5b",
    setName: "Black Bolt",
    collectorNumber: "034/086",
    printedTotal: 86,
    externalIds: {},
    ...over,
  });

  it("uses the CardTrader blueprint TCGdex links, without searching CardTrader", async () => {
    const fetchImpl = routes([
      [
        "api.tcgdex.net/v2/en/cards/sv03.5-005",
        json({
          variants_detailed: [
            { type: "normal", thirdParty: { cardmarket: 733600, tcgplayer: 502557, cardtrader: 261162 } },
            { type: "reverse", foil: "pokeball", thirdParty: { cardmarket: 733999, cardtrader: 299999 } },
          ],
        }),
      ],
    ]);
    const provider = new CardTraderProvider({
      token: "t",
      fetch: fetchImpl as never,
      tcgdex: new TcgdexPriceClient({ fetch: fetchImpl as never }),
    });
    const charmeleon = card({
      cardName: "Charmeleon",
      setCode: "sv03.5",
      setName: "151",
      collectorNumber: "005/165",
      externalIds: { "tcgdex-pokemon": "sv03.5-005" },
    });
    expect(await provider.resolveMapping(charmeleon)).toMatchObject({
      externalId: "261162",
      status: "matched",
      confidence: 1,
      url: "https://www.cardtrader.com/cards/261162",
    });
    // The ordinary reverse holo is the same blueprint on CardTrader, not the Poké Ball one.
    expect(await provider.resolveMapping({ ...charmeleon, finish: "REVERSE_HOLO" })).toMatchObject({
      externalId: "261162",
    });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("cardtrader.com"))).toBe(false);
  });

  it("an English card never lands on the Japanese or a patterned reverse holo expansion", async () => {
    const fetchImpl = routes([
      games,
      ["/expansions", json(blackBolt)],
      ["/blueprints/export?expansion_id=4195", json([zekrom(501)])],
      ["/blueprints/export?expansion_id=4188", json([zekrom(601)])],
      ["/blueprints/export?expansion_id=4266", json([zekrom(701)])],
    ]);
    const provider = new CardTraderProvider({ token: "t", fetch: fetchImpl as never });
    expect(await provider.resolveMapping(card())).toMatchObject({ externalId: "501", status: "matched" });
    const requested = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(requested.some((u) => u.includes("expansion_id=4188"))).toBe(false);
    expect(requested.some((u) => u.includes("expansion_id=4266"))).toBe(false);
  });

  it("an English card whose English expansion CardTrader lacks is not priced from the Japanese one", async () => {
    const fetchImpl = routes([
      games,
      ["/expansions", json(blackBolt.filter((e) => e.id !== 4195))],
      ["/blueprints/export?expansion_id=4188", json([zekrom(601)])],
    ]);
    const provider = new CardTraderProvider({ token: "t", fetch: fetchImpl as never });
    expect(await provider.resolveMapping(card())).toMatchObject({ status: "not_found" });
  });

  it("a Japanese card is matched to the Japanese expansion by its set code", async () => {
    const fetchImpl = routes([
      games,
      ["/expansions", json(blackBolt)],
      ["/blueprints/export?expansion_id=4188", json([zekrom(601)])],
      ["/blueprints/export?expansion_id=4195", json([zekrom(501)])],
    ]);
    const provider = new CardTraderProvider({ token: "t", fetch: fetchImpl as never });
    const japanese = card({
      cardName: "ゼクロムex",
      setCode: "ja-SV11B",
      setName: "ブラックボルト",
      languageCode: "ja",
    });
    expect(await provider.resolveMapping(japanese)).toMatchObject({ externalId: "601" });
  });

  it("finds a card by Cardmarket id when CardTrader names the set nothing like we do (30th Classic Collection)", async () => {
    const fetchImpl = routes([
      games,
      [
        "/expansions",
        json([
          { id: 10, game_id: 5, code: "wotcp", name: "Wizards of the Coast Era Promos" },
          { id: 11, game_id: 5, code: "30c", name: "Pokémon 30th Anniversary Classic Collection" },
          { id: 12, game_id: 5, code: "misc", name: "Miscellaneous Promos" },
        ]),
      ],
      ["/blueprints/export?expansion_id=10", json([{ id: 1, name: "Charizard", fixed_properties: { collector_number: "4" } }])],
      ["/blueprints/export?expansion_id=12", json([])],
      [
        "/blueprints/export?expansion_id=11",
        json([{ id: 330001, name: "Charizard", card_market_ids: [907940], fixed_properties: { collector_number: "001/030" } }]),
      ],
      [
        "api.tcgdex.net/v2/it/cards/30th-c-001",
        json({ variants_detailed: [{ type: "holo", stamp: ["30th-anniversary"], thirdParty: { cardmarket: 907940, tcgplayer: 714372 } }] }),
      ],
    ]);
    const provider = new CardTraderProvider({
      token: "t",
      fetch: fetchImpl as never,
      tcgdex: new TcgdexPriceClient({ fetch: fetchImpl as never }),
    });
    const charizard = card({
      cardName: "Charizard",
      setCode: "it-30th-c",
      setName: "Collzione Classica del 30°",
      setNameAlt: "30th Celebration",
      collectorNumber: "001/30",
      printedTotal: 30,
      finish: "HOLO",
      printingFinishes: ["HOLO"],
      languageCode: "it",
      externalIds: { "tcgdex-pokemon-it": "30th-c-001" },
    });
    expect(await provider.resolveMapping(charizard)).toMatchObject({
      externalId: "330001",
      status: "matched",
      confidence: 1,
      notes: 'Same Cardmarket product id, in "Pokémon 30th Anniversary Classic Collection"',
    });
    // The second card of the set is a lookup: nothing is fetched from CardTrader again.
    const before = fetchImpl.mock.calls.filter(([u]) => String(u).includes("blueprints")).length;
    await provider.resolveMapping(charizard);
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes("blueprints")).length).toBe(before);
  });

  it("matches a card from another language by its English name", async () => {
    const fetchImpl = routes([
      games,
      ["/expansions", json(blackBolt)],
      ["/blueprints/export?expansion_id=4195", json([zekrom(501)])],
    ]);
    const provider = new CardTraderProvider({ token: "t", fetch: fetchImpl as never });
    const french = card({
      cardName: "Zekrom-ex",
      cardNameAlt: "Zekrom ex",
      setCode: "fr-sv10.5b",
      setName: "Foudre Noire",
      setNameAlt: "Black Bolt",
      languageCode: "fr",
    });
    expect(await provider.resolveMapping(french)).toMatchObject({ externalId: "501", confidence: 1 });
  });
});

describe("scoreExpansion / bareSetCode", () => {
  const ours = { setCode: "sv10.5b", setName: "Black Bolt", setNameAlt: null, languageCode: "en" };
  it("strips language-catalog prefixes", () => {
    expect(bareSetCode("ja-SV11B")).toBe("SV11B");
    expect(bareSetCode("zh-tw-SV1")).toBe("SV1");
    expect(bareSetCode("JP-sm-p")).toBe("sm-p");
    expect(bareSetCode("sv06.5")).toBe("sv06.5");
  });
  it("scores the English release, never the Japanese or patterned ones, for an English card", () => {
    expect(scoreExpansion(ours, { id: 1, game_id: 5, name: "Black Bolt", code: "blk" }).score).toBe(1);
    expect(scoreExpansion(ours, { id: 2, game_id: 5, name: "Black Bolt | sv11B", code: "sv11b" }).score).toBe(0);
    expect(
      scoreExpansion(ours, { id: 3, game_id: 5, name: "Black Bolt - Poké Ball Reverse Holo", code: "p-blk" }).score,
    ).toBe(0);
  });
  it("a Japanese card prefers the Japanese release", () => {
    const ja = { ...ours, setCode: "ja-SV11B", setName: "ブラックボルト", languageCode: "ja" };
    expect(scoreExpansion(ja, { id: 2, game_id: 5, name: "Black Bolt | sv11B", code: "sv11b" }).score).toBe(0.95);
    expect(scoreExpansion(ja, { id: 1, game_id: 5, name: "Black Bolt", code: "blk" }).score).toBe(0);
  });
});

describe("tcgdexMarketIdsFor", () => {
  const card = {
    thirdParty: { cardmarket: 1 },
    variants: [
      { type: "normal", stamps: [], cardmarket: 10, cardtrader: 100 },
      { type: "reverse", foil: "masterball", stamps: [], cardmarket: 11, cardtrader: 101 },
      { type: "holo", stamps: ["pre-release"], cardmarket: 12 },
    ],
  };
  it("picks the plain variant of the finish, and the base card for an ordinary reverse holo", () => {
    expect(tcgdexMarketIdsFor(card, "NON_FOIL")).toEqual({ cardmarket: 10, cardtrader: 100 });
    expect(tcgdexMarketIdsFor(card, "REVERSE_HOLO")).toEqual({ cardmarket: 10, cardtrader: 100 });
    expect(tcgdexMarketIdsFor(card, "HOLO")).toEqual({ cardmarket: 12 });
  });
  it("falls back to the card-level ids", () => {
    expect(tcgdexMarketIdsFor({ thirdParty: { cardmarket: 5 }, variants: [] }, "HOLO")).toEqual({ cardmarket: 5 });
  });
});
