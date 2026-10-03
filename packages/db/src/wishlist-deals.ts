import { convertMinor } from "@tcg-vault/shared";
import { prisma } from "./client";
import { loadFxRates } from "./fx";

/**
 * Wishlist deal finder: a wishlist card with a target price is flagged when
 * its cheapest current CardTrader or eBay listing (any finish, ordinary print)
 * is at or under the target. Only observations from the last two weeks count,
 * so a listing that has since sold doesn't keep flagging.
 */

export const DEAL_PROVIDERS = ["cardtrader", "ebay"] as const;
export const DEAL_WINDOW_MS = 14 * 86_400_000;

export interface WishlistDeal {
  printingId: string;
  targetEur: number;
  /** Cheapest listing seen, EUR minor units; null = no recent listing from either source. */
  lowestEur: number | null;
  provider: string | null;
  variantId: string | null;
  observedAt: Date | null;
  hit: boolean;
}

export async function setWishlistTarget(printingId: string, eur: number | null): Promise<void> {
  const cents = eur === null ? null : Math.round(eur * 100);
  if (cents !== null && (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000))
    throw new Error("Enter a price above 0");
  await prisma.wishlistItem.update({ where: { printingId }, data: { targetEur: cents } });
}

export async function wishlistDeals(now = new Date()): Promise<Map<string, WishlistDeal>> {
  const items = await prisma.wishlistItem.findMany({
    where: { targetEur: { not: null } },
    select: {
      printingId: true,
      targetEur: true,
      printing: { select: { variants: { where: { edition: "UNLIMITED" }, select: { id: true } } } },
    },
  });
  const out = new Map<string, WishlistDeal>();
  if (items.length === 0) return out;
  const variantIds = items.flatMap((i) => i.printing.variants.map((v) => v.id));
  const since = new Date(now.getTime() - DEAL_WINDOW_MS);
  const [obs, rates] = await Promise.all([
    prisma.priceObservation.findMany({
      where: {
        variantId: { in: variantIds },
        provider: { in: [...DEAL_PROVIDERS] },
        kind: "lowest_listing",
        amount: { not: null },
        observedAt: { gte: since },
      },
      orderBy: { observedAt: "desc" },
      select: { variantId: true, provider: true, amount: true, currency: true, observedAt: true },
    }),
    loadFxRates(),
  ]);
  // Latest observation per variant x provider: older ones are superseded.
  const latest = new Map<string, (typeof obs)[number]>();
  for (const o of obs) {
    const key = `${o.variantId}|${o.provider}`;
    if (!latest.has(key)) latest.set(key, o);
  }
  const byVariant = new Map<string, Array<(typeof obs)[number]>>();
  for (const o of latest.values()) {
    const list = byVariant.get(o.variantId) ?? [];
    list.push(o);
    byVariant.set(o.variantId, list);
  }

  for (const item of items) {
    let best: WishlistDeal = {
      printingId: item.printingId,
      targetEur: item.targetEur!,
      lowestEur: null,
      provider: null,
      variantId: null,
      observedAt: null,
      hit: false,
    };
    for (const v of item.printing.variants) {
      for (const o of byVariant.get(v.id) ?? []) {
        const eur = convertMinor(o.amount!, o.currency, "EUR", rates);
        if (eur === null || (best.lowestEur !== null && eur >= best.lowestEur)) continue;
        best = { ...best, lowestEur: eur, provider: o.provider, variantId: v.id, observedAt: o.observedAt };
      }
    }
    best.hit = best.lowestEur !== null && best.lowestEur <= best.targetEur;
    out.set(item.printingId, best);
  }
  return out;
}
