import Link from "next/link";
import { collectionItemValue, latestValuations, prisma } from "@tcg-vault/db";
import { mediaUrl } from "@tcg-vault/shared";
import { deleteCollectionItem } from "../actions";
import { FinishBadge, PriceChip, formatEur } from "../../components/money";
import { cardHref } from "../../lib/cards";

// No DATABASE_URL at build time (only set at runtime by the desktop sidecar) —
// prerendering this page would fail, so it must render on request instead.
export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  const items = await prisma.collectionItem.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      variant: {
        include: {
          printing: { include: { card: true, set: { include: { game: true } } } },
        },
      },
    },
  });

  const totalCards = items.reduce((sum, item) => sum + item.quantity, 0);
  const values = await latestValuations(items.map((i) => i.variantId));
  const itemValues = new Map(
    items.map((i) => [i.id, collectionItemValue(values.get(i.variantId)?.valueEur, i)]),
  );
  const totalValue = [...itemValues.values()].reduce<number>((sum, v) => sum + (v ?? 0), 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">My collection</h1>
        <p className="text-sm text-neutral-500">
          {items.length} entr{items.length === 1 ? "y" : "ies"} · {totalCards} card
          {totalCards === 1 ? "" : "s"}
          {totalValue > 0 ? (
            <>
              {" "}
              · <span className="font-semibold text-neutral-900">{formatEur(totalValue)}</span>
            </>
          ) : null}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-neutral-500">
          Nothing here yet.{" "}
          <Link href="/browse" className="underline">
            Browse the catalog
          </Link>{" "}
          and add a card.
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {items.map((item) => {
            const { printing } = item.variant;
            const href = cardHref(
              printing.set.game.slug,
              printing.set.code,
              printing.collectorNumber,
            );
            return (
              <li key={item.id} className="flex items-center gap-4 py-3">
                {printing.imageKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(printing.imageKey)}
                    alt={printing.card.name}
                    className="h-16 w-auto rounded"
                  />
                ) : (
                  <div className="h-16 w-12 rounded bg-neutral-100" />
                )}
                <div className="flex-1">
                  <Link href={href} className="font-medium hover:underline">
                    {printing.card.name}
                  </Link>
                  <p className="flex items-center gap-2 text-sm text-neutral-500">
                    {printing.set.name} · {printing.collectorNumber}
                    <FinishBadge finish={item.variant.finish} />
                  </p>
                  <p className="text-xs text-neutral-400">
                    Qty {item.quantity}
                    {item.gradingCompany
                      ? ` · ${item.gradingCompany} ${item.grade ?? ""}`
                      : item.condition
                        ? ` · ${item.condition.replaceAll("_", " ")}`
                        : ""}
                    {item.purchasePrice !== null
                      ? ` · paid ${formatEur(item.purchasePrice)}/card`
                      : ""}
                  </p>
                </div>
                <PriceChip value={itemValues.get(item.id)} />
                <form action={deleteCollectionItem}>
                  <input type="hidden" name="id" value={item.id} />
                  <button type="submit" className="text-sm text-neutral-400 hover:text-red-600">
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
