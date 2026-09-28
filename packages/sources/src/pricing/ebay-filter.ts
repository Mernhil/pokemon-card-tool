import { median } from "./http";
import { normalizeName } from "./matching";

/**
 * eBay search results are noisy: lots, proxies, graded slabs, sealed product,
 * other languages and other cards all show up for "Charizard ex 199/165".
 * These are the explicit rules a listing must pass before its price counts.
 * Each rule is a named predicate so the card page / tests can say *why* a
 * listing was dropped. Unit-tested in ebay-filter.test.ts.
 */

export interface EbayListing {
  itemId: string;
  title: string;
  /** Minor units. */
  price: number;
  currency: string;
  buyingOptions?: string[];
  /** eBay condition id: 2750 = Graded, 4000 = Ungraded (trading cards). */
  conditionId?: string;
}

export interface ListingContext {
  cardName: string;
  collectorNumber: string;
  printedTotal?: number | null;
  finish: string;
  languageCode: string;
  /** Raw (ungraded) prices only. Graded copies are a different market. */
  wantGraded?: boolean;
}

export interface ListingRule {
  id: string;
  description: string;
  rejects: (listing: EbayListing, ctx: ListingContext) => boolean;
}

/** Language words in titles; the target language's own words are allowed. */
const LANGUAGE_WORDS: Record<string, RegExp> = {
  ja: /\b(japanese|japan|jpn?|japon|japonais)\b/i,
  ko: /\b(korean|kor)\b/i,
  zh: /\b(chinese|chn|s-?chinese|t-?chinese|simplified chinese|traditional chinese)\b/i,
  de: /\b(german|deutsch)\b/i,
  fr: /\b(french|fran[cç]ais|francaise)\b/i,
  it: /\b(italian|italiano)\b/i,
  es: /\b(spanish|espa[nñ]ol)\b/i,
  pt: /\b(portuguese|portugu[eê]s)\b/i,
  nl: /\b(dutch|nederlands)\b/i,
  pl: /\b(polish|polski)\b/i,
  ru: /\b(russian)\b/i,
  th: /\b(thai)\b/i,
  id: /\b(indonesian)\b/i,
};

function localNumberPattern(ctx: ListingContext): RegExp {
  const local = ctx.collectorNumber.split("/")[0]!.trim();
  const m = local.match(/^([A-Za-z]*)\s*0*(\d+)([A-Za-z]*)$/);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!m) return new RegExp(`(^|[^A-Za-z0-9])${esc(local)}($|[^A-Za-z0-9])`, "i");
  const [, prefix, digits, suffix] = m;
  const num = `${esc(prefix!)}\\s*0*${digits}${esc(suffix!)}`;
  if (ctx.printedTotal) {
    // "001/064", "1/64", "#001/064", "001 / 064"; prefix totals like "TG01/TG30" too.
    return new RegExp(
      `(^|[^A-Za-z0-9])${num}\\s*/\\s*[A-Za-z]*0*${ctx.printedTotal}($|[^0-9])`,
      "i",
    );
  }
  // No printed total (promos): the number must stand alone.
  return new RegExp(`(^|[^A-Za-z0-9])#?${num}($|[^A-Za-z0-9])`, "i");
}

export const EBAY_LISTING_RULES: ListingRule[] = [
  {
    id: "auction",
    description: "Auctions: the current bid isn't a price anyone agreed to yet",
    rejects: (l) => !!l.buyingOptions && !l.buyingOptions.includes("FIXED_PRICE"),
  },
  {
    id: "lot-or-bundle",
    description: "Lots, bundles, playsets and multiples (price isn't for one card)",
    rejects: (l) =>
      /\b(lot|lots|bundle|bulk|job ?lot|collection|playset|set of \d+)\b/i.test(l.title) ||
      /(^|\s)(\d+\s?x|x\s?\d+)(\s|$)/i.test(l.title) ||
      /\b\d+\s?(cards|karten|cartes|carte)\b/i.test(l.title),
  },
  {
    id: "proxy-or-fake",
    description: "Proxies, replicas, customs, metal/gold cards and other non-originals",
    rejects: (l) =>
      /\b(proxy|proxies|replica|custom|fan[\s-]?art|fan[\s-]?made|orica|fake|unofficial|not original|metal|gold[\s-]?plated|24k|reprint|art card|acrylic|sticker)\b/i.test(
        l.title,
      ),
  },
  {
    id: "graded",
    description: "Graded slabs (PSA/BGS/CGC/…) when pricing raw copies",
    rejects: (l, ctx) =>
      !ctx.wantGraded &&
      (l.conditionId === "2750" ||
        /\b(psa|bgs|cgc|sgc|beckett|ace grading|tag grading|graded|slab|slabbed)\b/i.test(l.title)),
  },
  {
    id: "sealed-or-digital",
    description: "Sealed product, packs and code cards",
    rejects: (l) =>
      /\b(booster|packs?|etb|elite trainer|tin|blister|sealed|code card|online code|ptcgo|ptcgl|live code|digital)\b/i.test(
        // "pack fresh" is a condition claim for a single card, not a pack.
        l.title.replace(/pack[\s-]?fresh/gi, ""),
      ),
  },
  {
    id: "damaged",
    description: "Damaged copies (skew the raw price down)",
    rejects: (l) =>
      /\b(damaged|heavily played|creased?|water damage|poor condition)\b/i.test(l.title),
  },
  {
    id: "wrong-language",
    description: "Titles naming another language than the one we're pricing",
    rejects: (l, ctx) =>
      Object.entries(LANGUAGE_WORDS).some(
        ([code, pattern]) => code !== ctx.languageCode.split("-")[0] && pattern.test(l.title),
      ),
  },
  {
    id: "wrong-number",
    description: "Doesn't show our collector number (a different card or set)",
    rejects: (l, ctx) => !localNumberPattern(ctx).test(l.title),
  },
  {
    id: "wrong-name",
    description: "Doesn't contain every word of the card's name (parenthesised parts are optional)",
    rejects: (l, ctx) => {
      const title = ` ${normalizeName(l.title)} `;
      return normalizeName(ctx.cardName.replace(/\([^)]*\)/g, " "))
        .split(" ")
        .filter(Boolean)
        .some((word) => !title.includes(` ${word} `));
    },
  },
  {
    id: "wrong-finish",
    description: "Reverse holo listed when we price the regular card, or the other way round",
    rejects: (l, ctx) =>
      /\breverse\b|\brev\s?holo\b/i.test(l.title) !== (ctx.finish === "REVERSE_HOLO"),
  },
];

export interface FilterResult {
  accepted: EbayListing[];
  rejected: Array<{ listing: EbayListing; rule: string }>;
}

/** Applies every rule (first failing rule is reported), then drops price outliers. */
export function filterListings(listings: EbayListing[], ctx: ListingContext): FilterResult {
  const accepted: EbayListing[] = [];
  const rejected: FilterResult["rejected"] = [];
  for (const listing of listings) {
    const rule = EBAY_LISTING_RULES.find((r) => r.rejects(listing, ctx));
    if (rule) rejected.push({ listing, rule: rule.id });
    else accepted.push(listing);
  }
  return removeOutliers(accepted, rejected);
}

/**
 * Listings priced far from the rest are almost always mislabelled (a lot
 * that slipped through, a typo, a "read description" placeholder price).
 * With at least 4 listings, drops anything under 1/4 or over 4x the median.
 */
function removeOutliers(accepted: EbayListing[], rejected: FilterResult["rejected"]): FilterResult {
  if (accepted.length < 4) return { accepted, rejected };
  const byCurrency = new Map<string, number>();
  for (const currency of new Set(accepted.map((l) => l.currency))) {
    byCurrency.set(
      currency,
      median(accepted.filter((l) => l.currency === currency).map((l) => l.price)),
    );
  }
  const kept: EbayListing[] = [];
  for (const listing of accepted) {
    const m = byCurrency.get(listing.currency)!;
    if (listing.price < m / 4 || listing.price > m * 4)
      rejected.push({ listing, rule: "price-outlier" });
    else kept.push(listing);
  }
  return { accepted: kept, rejected };
}

/** Query that finds the card's listings; the rules above do the precise filtering. */
export function ebayQueryFor(
  ctx: Pick<ListingContext, "cardName" | "collectorNumber" | "finish">,
): string {
  const reverse = ctx.finish === "REVERSE_HOLO" ? " reverse holo" : "";
  return `${ctx.cardName} ${ctx.collectorNumber}${reverse}`;
}
