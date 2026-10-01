import type {
  CatalogSourceAdapter,
  SourcePriceQuote,
  SourcePrinting,
  SourceSet,
  SourceSetSummary,
} from "../types";

/**
 * Pokémon promo, event and prize cards that TCGdex doesn't carry — the
 * Japan-only promos (Poncho-wearing Pikachu, CoroCoro cards, ...) and English
 * tournament/prize/kit cards — from tcgcsv.com, a free daily dump of TCGplayer's
 * catalog. Each product also comes with its TCGplayer prices (USD).
 *
 * Added on top of the TCGdex adapter with {@link withExtraSets}; set codes are
 * prefixed ("JP-", "EN-") so they never collide with TCGdex ids.
 */

const BASE = "https://tcgcsv.com/tcgplayer";
const JAPAN = { categoryId: 85, prefix: "JP-", languageCode: "ja" } as const;
const ENGLISH = { categoryId: 3, prefix: "EN-", languageCode: "en" } as const;

/** Japanese groups worth importing: every promo-like one. */
const JAPAN_GROUP = /promo|player placement|corocoro|information|unnumbered/i;
/** TCGdex's Japanese catalog already has these (with Cardmarket prices). */
const JAPAN_IN_TCGDEX = /^(SV-P|M-P)/i;
/**
 * English groups TCGdex has no set for. (Sets like "SVP" or "McDonald's" are
 * already there, so a plain /promo/ would duplicate them.)
 */
const ENGLISH_GROUP =
  /trainer kit|training kit|prize pack|league|deck exclusives|alternate art|blister exclusives|burger king|countdown|kids wb|best of|pikachu world|professor program|world championship|southeast asia|first partner|player placement/i;

interface Group {
  groupId: number;
  name: string;
  abbreviation?: string;
  publishedOn?: string;
}

interface Product {
  productId: number;
  name: string;
  imageUrl?: string;
  extendedData?: Array<{ name: string; value: string }>;
}

interface PriceRow {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  marketPrice: number | null;
  subTypeName?: string;
}

type Region = typeof JAPAN | typeof ENGLISH;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "SM-P: Sun & Moon Promos" -> "sm-p"; names without an abbreviation use the whole name. */
export function tcgcsvSetCode(region: Region, group: Group): string {
  const head = group.name.includes(":") ? group.name.split(":")[0]! : group.name;
  return `${region.prefix}${slug(head)}`;
}

function field(product: Product, name: string): string | undefined {
  return product.extendedData?.find((d) => d.name === name)?.value || undefined;
}

const FINISH_FOR: Record<string, string> = {
  normal: "NON_FOIL",
  holofoil: "HOLO",
  "reverse holofoil": "REVERSE_HOLO",
};

const cents = (usd: number | null | undefined): number | undefined =>
  typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : undefined;

/** Pure: one product (+ its price rows) -> our printing. Null for sealed product and the like. */
export function mapTcgcsvProduct(
  product: Product,
  prices: PriceRow[],
  numberOverride?: string,
): SourcePrinting | null {
  const printed = field(product, "Number");
  // Booster packs, boxes, ... have neither a number nor a card type. Older promos have a
  // type but no number: the product id is the one stable thing to key them by.
  if (!printed && !field(product, "CardType")) return null;
  const number = printed ?? String(product.productId);

  const cardName =
    (printed && product.name.endsWith(` - ${printed}`)
      ? product.name.slice(0, -(printed.length + 3))
      : product.name
    ).trim() || product.name;
  const hp = field(product, "HP");
  const cardType = hp ? "Pokemon" : /energy/i.test(product.name) ? "Energy" : "Trainer";

  const attributes: Record<string, unknown> = {};
  if (hp) attributes.hp = Number(hp) || hp;
  const type = field(product, "CardType");
  if (type && hp) attributes.types = [type];
  const description = field(product, "Description");
  if (description) attributes.description = description.replace(/<[^>]+>/g, " ").trim();
  const stage = field(product, "Stage");

  const quotes: SourcePriceQuote[] = [];
  const finishes: string[] = [];
  for (const row of prices) {
    const finish = FINISH_FOR[(row.subTypeName ?? "Normal").toLowerCase()];
    if (!finish) continue;
    finishes.push(finish);
    const market = cents(row.marketPrice);
    const mid = cents(row.midPrice);
    const low = cents(row.lowPrice);
    if (market === undefined && mid === undefined && low === undefined) continue;
    quotes.push({
      finish,
      source: "TCGPLAYER",
      currency: "USD",
      ...(market !== undefined ? { market } : {}),
      ...(mid !== undefined ? { mid } : {}),
      ...(low !== undefined ? { low } : {}),
      externalId: String(product.productId),
    });
  }

  const img = product.imageUrl;
  return {
    externalCardId: `tcgcsv-${product.productId}`,
    cardName,
    cardType,
    subtypes: stage ? [stage] : [],
    collectorNumber: numberOverride ?? number,
    rarityName: field(product, "Rarity"),
    imageUrls: img
      ? [img.replace(/_200w\./, "_in_1000x1000."), img.replace(/_200w\./, "_400w."), img]
      : undefined,
    attributes,
    finishes: finishes.length > 0 ? [...new Set(finishes)] : ["NON_FOIL"],
    prices: quotes,
  };
}

export class TcgcsvPromoAdapter {
  private readonly fetchImpl: typeof fetch;
  private groupsCache: Promise<Array<{ region: Region; group: Group; code: string }>> | null = null;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  private async json<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url, { headers: { "User-Agent": "TCG-Vault/1.0 (personal collection tracker)", Accept: "application/json" } });
    if (!res.ok) throw new Error(`tcgcsv request failed: ${url} -> HTTP ${res.status}`);
    const body = (await res.json()) as { results?: T };
    return (body.results ?? []) as T;
  }

  private groups() {
    this.groupsCache ??= (async () => {
      const out: Array<{ region: Region; group: Group; code: string }> = [];
      for (const [region, wanted] of [
        [JAPAN, JAPAN_GROUP],
        [ENGLISH, ENGLISH_GROUP],
      ] as const) {
        const groups = await this.json<Group[]>(`${BASE}/${region.categoryId}/groups`);
        const taken = new Set<string>();
        for (const group of groups.filter((g) => wanted.test(g.name) && !(region === JAPAN && JAPAN_IN_TCGDEX.test(g.name)))) {
          let code = tcgcsvSetCode(region, group);
          if (taken.has(code)) code = `${code}-${group.groupId}`;
          taken.add(code);
          out.push({ region, group, code });
        }
      }
      return out;
    })();
    this.groupsCache.catch(() => (this.groupsCache = null));
    return this.groupsCache;
  }

  async listSets(): Promise<SourceSet[]> {
    return (await this.groups()).map(({ region, group, code }) => ({
      code,
      name: region.languageCode === "ja" ? `${group.name} (Japanese)` : group.name,
      series: region.languageCode === "ja" ? "Japanese promos" : "Promos & events",
      releaseDate: group.publishedOn?.slice(0, 10),
      languageCode: region.languageCode,
    }));
  }

  async listSetSummaries(): Promise<SourceSetSummary[]> {
    return (await this.listSets()).map((s) => ({ code: s.code, name: s.name }));
  }

  async getSet(setCode: string): Promise<SourceSet | null> {
    return (await this.listSets()).find((s) => s.code === setCode) ?? null;
  }

  async listPrintings(setCode: string): Promise<SourcePrinting[]> {
    const entry = (await this.groups()).find((g) => g.code === setCode);
    if (!entry) return [];
    const root = `${BASE}/${entry.region.categoryId}/${entry.group.groupId}`;
    const [products, prices] = await Promise.all([
      this.json<Product[]>(`${root}/products`),
      this.json<PriceRow[]>(`${root}/prices`),
    ]);
    const byProduct = new Map<number, PriceRow[]>();
    for (const row of prices) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row]);

    // A printing is keyed by its number: two products sharing one (a reprint, a
    // "corrected" card) would overwrite each other, so later ones get their id appended.
    const seen = new Set<string>();
    const printings: SourcePrinting[] = [];
    for (const product of products) {
      const probe = mapTcgcsvProduct(product, []);
      if (!probe) continue;
      const dup = seen.has(probe.collectorNumber);
      const printing = mapTcgcsvProduct(
        product,
        byProduct.get(product.productId) ?? [],
        dup ? `${probe.collectorNumber}-${product.productId}` : undefined,
      );
      if (!printing) continue;
      seen.add(probe.collectorNumber);
      printings.push(printing);
    }
    return printings;
  }
}

/**
 * Adds a second source's sets to a catalog adapter. Sets whose code starts
 * with one of `prefixes` are served by `extra`; everything else by the base.
 * If `extra` is unreachable the base still works.
 */
export function withExtraSets(
  base: CatalogSourceAdapter,
  extra: Pick<CatalogSourceAdapter, "listSets" | "listSetSummaries" | "getSet" | "listPrintings">,
  prefixes: string[],
): CatalogSourceAdapter {
  const isExtra = (code: string) => prefixes.some((p) => code.startsWith(p));
  const wrapped: CatalogSourceAdapter = Object.create(base);
  wrapped.listSets = async () => [
    ...(await base.listSets()),
    ...(await extra.listSets().catch(() => [])),
  ];
  wrapped.listSetSummaries = async () => [
    ...(await base.listSetSummaries()),
    ...(await extra.listSetSummaries().catch(() => [])),
  ];
  wrapped.getSet = (code) => (isExtra(code) ? extra.getSet(code) : base.getSet(code));
  wrapped.listPrintings = (code) =>
    isExtra(code) ? extra.listPrintings(code) : base.listPrintings(code);
  return wrapped;
}

export const TCGCSV_SET_PREFIXES = [JAPAN.prefix, ENGLISH.prefix];

/**
 * TCGdex has no scan (and often no price) for many Japanese sets. tcgcsv's
 * Japanese groups are named after the same set ids ("SV11W: White Flare"), so
 * a Japanese printing missing either one is looked up there by set id + card
 * number, and gets TCGplayer's picture and USD price.
 */
export class TcgcsvJapanFallback {
  private readonly fetchImpl: typeof fetch;
  private groupsCache: Promise<Map<string, Group>> | null = null;
  private readonly setCache = new Map<number, Promise<Map<number, SourcePrinting>>>();

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = fetchImpl;
  }

  private async json<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url, {
      headers: { "User-Agent": "TCG-Vault/1.0 (personal collection tracker)", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`tcgcsv request failed: ${url} -> HTTP ${res.status}`);
    return (((await res.json()) as { results?: T }).results ?? []) as T;
  }

  /** Group per lower-cased set id (the text before the colon or first space). */
  private groups(): Promise<Map<string, Group>> {
    this.groupsCache ??= this.json<Group[]>(`${BASE}/${JAPAN.categoryId}/groups`).then((groups) => {
      const byId = new Map<string, Group>();
      for (const g of groups) {
        const id = g.name.split(/[:\s]/)[0]!.toLowerCase();
        if (id && !byId.has(id)) byId.set(id, g);
      }
      return byId;
    });
    this.groupsCache.catch(() => (this.groupsCache = null));
    return this.groupsCache;
  }

  /** The group's cards by their number's first part ("001/086" -> 1). */
  private async cards(group: Group): Promise<Map<number, SourcePrinting>> {
    let hit = this.setCache.get(group.groupId);
    if (!hit) {
      hit = (async () => {
        const root = `${BASE}/${JAPAN.categoryId}/${group.groupId}`;
        const [products, prices] = await Promise.all([
          this.json<Product[]>(`${root}/products`),
          this.json<PriceRow[]>(`${root}/prices`),
        ]);
        const byProduct = new Map<number, PriceRow[]>();
        for (const row of prices)
          byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row]);
        const out = new Map<number, SourcePrinting>();
        // Plain cards first: pattern/alternate versions share a number and must not win.
        const ordered = [...products].sort(
          (a, b) => Number(a.name.includes("(")) - Number(b.name.includes("(")),
        );
        for (const product of ordered) {
          const printing = mapTcgcsvProduct(product, byProduct.get(product.productId) ?? []);
          const n = parseInt(field(product, "Number")?.split("/")[0] ?? "", 10);
          if (printing && Number.isFinite(n) && !out.has(n)) out.set(n, printing);
        }
        return out;
      })();
      hit.catch(() => this.setCache.delete(group.groupId));
      this.setCache.set(group.groupId, hit);
    }
    return hit;
  }

  async fill(setId: string, printings: SourcePrinting[]): Promise<SourcePrinting[]> {
    const noTcgplayer = (p: SourcePrinting) => !p.prices?.some((q) => q.source === "TCGPLAYER");
    const needs = printings.some((p) => !p.imageUrls?.length || noTcgplayer(p));
    if (!needs) return printings;
    const group = (await this.groups()).get(setId.toLowerCase());
    if (!group) return printings;
    const cards = await this.cards(group);
    return printings.map((p) => {
      const n = parseInt(p.collectorNumber.split("/")[0] ?? "", 10);
      const match = cards.get(n);
      if (!match) return p;
      const filled = { ...p };
      if (!p.imageUrls?.length && match.imageUrls) filled.imageUrls = match.imageUrls;
      if (noTcgplayer(p) && match.prices?.length) {
        // Its finish names rarely line up with TCGdex's: price the printing's first finish.
        const finishes = p.finishes?.length ? p.finishes : ["NON_FOIL"];
        const row = match.prices.find((q) => finishes.includes(q.finish)) ?? match.prices[0]!;
        filled.prices = [
          ...(p.prices ?? []),
          { ...row, finish: finishes.includes(row.finish) ? row.finish : finishes[0]! },
        ];
      }
      return filled;
    });
  }
}

/** Wraps a prefixed Japanese adapter so its printings get {@link TcgcsvJapanFallback}'s pictures and prices. */
export function withTcgcsvJapanFallback(
  adapter: CatalogSourceAdapter,
  fallback: Pick<TcgcsvJapanFallback, "fill">,
  prefix: string,
): CatalogSourceAdapter {
  const wrapped: CatalogSourceAdapter = Object.create(adapter);
  wrapped.listPrintings = async (code) => {
    const printings = await adapter.listPrintings(code);
    try {
      return await fallback.fill(code.startsWith(prefix) ? code.slice(prefix.length) : code, printings);
    } catch {
      return printings; // the fallback being down never fails the sync
    }
  };
  return wrapped;
}
