import { variantKind } from "@tcg-vault/shared/src/enums";
import { Heart } from "lucide-react";
import Link from "next/link";
import { latestValuations, prisma, wishlistDeals } from "@tcg-vault/db";
import { CardTile } from "../../components/card-tile";
import { formatEur } from "../../components/money";
import { WishlistRemove } from "../../components/wishlist-remove";
import { WishlistTarget } from "../../components/wishlist-target";
import { ButtonLink } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";
import { cardHref, sortByFinish } from "../../lib/cards";
import { loadMoneyDisplay } from "../../lib/money-config";

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  await loadMoneyDisplay();
  const items = await prisma.wishlistItem.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      printing: {
        include: {
          card: true,
          set: { include: { game: true } },
          variants: { include: { collection: { select: { quantity: true } } } },
        },
      },
    },
  });
  const [values, deals] = await Promise.all([
    latestValuations(items.flatMap((i) => i.printing.variants.map((v) => v.id))),
    wishlistDeals(),
  ]);
  const rows = items.map((item) => {
    const p = item.printing;
    const prices = p.variants
      .map((v) => values.get(v.id)?.valueEur)
      .filter((x): x is number => typeof x === "number");
    return {
      id: p.id,
      href: cardHref(p.set.game.slug, p.set.code, p.collectorNumber),
      imageKey: p.imageKey,
      name: p.card.name,
      number: p.collectorNumber,
      subtitle: `${p.set.name} · ${p.collectorNumber}`,
      finishes: sortByFinish(p.variants).map((v) => variantKind(v)),
      // Cheapest finish: what it costs to get the card at all.
      price: prices.length ? Math.min(...prices) : null,
      owned: p.variants.reduce((s, v) => s + v.collection.reduce((q, c) => q + c.quantity, 0), 0),
      targetEur: item.targetEur === null ? null : item.targetEur / 100,
      deal: deals.get(p.id) ?? null,
    };
  });
  const total = rows.reduce((s, r) => s + (r.price ?? 0), 0);
  const hits = rows.filter((r) => r.deal?.hit);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Cards you want"
        title="Wishlist"
        subtitle={
          rows.length
            ? `${rows.length} card${rows.length === 1 ? "" : "s"} · about ${formatEur(total)} at the cheapest finish`
            : undefined
        }
      />
      {hits.length > 0 ? (
        <section className="panel mb-5 border-emerald-300 bg-emerald-50 p-4 dark:bg-emerald-950/40" aria-label="Deals">
          <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            {hits.length} deal{hits.length === 1 ? "" : "s"} on your wishlist
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {hits.map((r) => (
              <li key={r.id}>
                <Link href={r.href} className="font-medium hover:text-accent">
                  {r.name} <span className="text-neutral-500">{r.number}</span>
                </Link>{" "}
                {formatEur(r.deal!.lowestEur!)} on {r.deal!.provider === "ebay" ? "eBay" : "CardTrader"}
                <span className="text-neutral-500"> · your target {formatEur(r.deal!.targetEur)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Your wishlist is empty"
          action={<ButtonLink href="/search">Search for cards</ButtonLink>}
        >
          Open any card and press “Wishlist” to keep it here for later.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {rows.map((r) => (
            <div key={r.id} className="group relative">
              <WishlistRemove printingId={r.id} cardName={r.name} />
              <CardTile
                href={r.href}
                imageKey={r.imageKey}
                name={r.name}
                number={r.number}
                subtitle={r.subtitle}
                finishes={r.finishes}
                price={r.price}
                owned={r.owned}
              />
              <WishlistTarget printingId={r.id} targetEur={r.targetEur} />
              {r.deal ? (
                <p className={`mt-0.5 text-center text-[11px] ${r.deal.hit ? "font-semibold text-emerald-700" : "text-neutral-500"}`}>
                  {r.deal.lowestEur === null
                    ? "No recent listing"
                    : `${r.deal.hit ? "Deal: " : "Lowest: "}${formatEur(r.deal.lowestEur)} ${r.deal.provider === "ebay" ? "eBay" : "CardTrader"}`}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
