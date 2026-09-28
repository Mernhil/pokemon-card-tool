import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CardTraderProvider,
  cardTraderObservations,
  matchBlueprint,
  type CardTraderBlueprint,
  type CardTraderProduct,
} from "./cardtrader";
import { EbayProvider, ebayObservations, parseEbaySearch } from "./ebay";
import { filterListings } from "./ebay-filter";
import { AuthError, RateLimitedError, parseRetryAfter, requestJson } from "./http";
import { normalizeName, normalizeNumber, scoreCardMatch, scoreSetMatch } from "./matching";
import { TcgdexMarketProvider, TcgdexPriceClient, quoteToObservations } from "./tcgdex-prices";
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
    const obs = cardTraderObservations(products, joltik);
    const byCondition = Object.fromEntries(obs.map((o) => [o.condition, o]));
    expect(byCondition.NEAR_MINT).toMatchObject({
      kind: "lowest_listing",
      amount: 9,
      currency: "EUR",
      listingCount: 2,
    });
    expect(byCondition.LIGHTLY_PLAYED).toMatchObject({ amount: 5, listingCount: 1 });
    expect(obs).toHaveLength(2);
  });

  it("only counts reverse holo listings for the reverse holo variant", () => {
    const obs = cardTraderObservations(products, { ...joltik, finish: "REVERSE_HOLO" });
    expect(obs).toEqual([
      expect.objectContaining({ amount: 45, condition: "NEAR_MINT", listingCount: 1 }),
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
    expect(obs.map((o) => o.kind)).toEqual(["asking", "lowest_listing"]);

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
