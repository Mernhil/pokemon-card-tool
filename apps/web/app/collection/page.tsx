import Link from "next/link";
import { prisma } from "@tcg-vault/db";
import { mediaUrl } from "@tcg-vault/shared";
import { deleteCollectionItem } from "../actions";

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

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">My collection</h1>
        <p className="text-sm text-neutral-500">
          {items.length} entr{items.length === 1 ? "y" : "ies"} · {totalCards} card
          {totalCards === 1 ? "" : "s"}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-neutral-500">
          Nothing here yet. <Link href="/browse" className="underline">Browse the catalog</Link> and
          add a card.
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {items.map((item) => {
            const { printing } = item.variant;
            const gameSlug = printing.set.game.slug;
            const setCode = printing.set.code;
            const number = String(printing.sortNumber).padStart(3, "0");
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
                  <Link
                    href={`/${gameSlug}/${encodeURIComponent(setCode)}/${number}`}
                    className="font-medium hover:underline"
                  >
                    {printing.card.name}
                  </Link>
                  <p className="text-sm text-neutral-500">
                    {printing.set.name} · {printing.collectorNumber} ·{" "}
                    {item.variant.finish.replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-neutral-400">
                    Qty {item.quantity}
                    {item.gradingCompany
                      ? ` · ${item.gradingCompany} ${item.grade ?? ""}`
                      : item.condition
                        ? ` · ${item.condition.replaceAll("_", " ")}`
                        : ""}
                  </p>
                </div>
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
