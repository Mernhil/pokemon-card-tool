import { variantKind } from "@tcg-vault/shared/src/enums";
import { Heart } from "lucide-react";
import { latestValuations, prisma } from "@tcg-vault/db";
import { CardTile } from "../../components/card-tile";
import { formatEur } from "../../components/money";
import { WishlistRemove } from "../../components/wishlist-remove";
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
  const values = await latestValuations(items.flatMap((i) => i.printing.variants.map((v) => v.id)));
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
    };
  });
  const total = rows.reduce((s, r) => s + (r.price ?? 0), 0);

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
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
