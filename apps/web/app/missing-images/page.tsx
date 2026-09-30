import Link from "next/link";
import { prisma } from "@tcg-vault/db";
import { cardHref } from "../../lib/cards";
import { PageHeader } from "../../components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Printings the catalog has no scan address for, per set, and whether another
 * printing of the same card covers them (a reprint shows its original's art).
 * DB only: nothing is fetched. For a probe of the addresses themselves see
 * `pnpm db:image-report`.
 */
export default async function MissingImagesPage() {
  const printings = await prisma.printing.findMany({
    where: {
      customImageKey: null,
      OR: [{ imageUrls: null }, { imageUrls: "[]" }],
    },
    orderBy: [{ setId: "asc" }, { sortNumber: "asc" }],
    include: { card: true, set: { include: { game: true } } },
  });

  // Which of those cards have a sibling printing with scan addresses?
  const cardIds = [...new Set(printings.map((p) => p.cardId))];
  const withArt = new Set(
    (
      await prisma.printing.findMany({
        where: {
          cardId: { in: cardIds },
          NOT: { OR: [{ imageUrls: null }, { imageUrls: "[]" }] },
        },
        select: { cardId: true },
      })
    ).map((p) => p.cardId),
  );

  const bySet = new Map<string, { name: string; rows: typeof printings }>();
  for (const p of printings) {
    const key = `${p.set.game.slug}/${p.set.code}`;
    if (!bySet.has(key)) bySet.set(key, { name: p.set.name, rows: [] });
    bySet.get(key)!.rows.push(p);
  }
  const uncovered = printings.filter((p) => !withArt.has(p.cardId)).length;

  return (
    <main className="page">
      <PageHeader eyebrow="Catalog" title="Cards without a scan" />
      <p className="mb-6 text-sm text-neutral-500">
        {printings.length === 0
          ? "Every card has a scan address."
          : `${printings.length} cards have no scan address from the sources; ${printings.length - uncovered} of them show the art of another printing of the same card, ${uncovered} show a placeholder.`}
      </p>
      {[...bySet.entries()].map(([key, { name, rows }]) => (
        <section key={key} className="panel mb-4 p-4">
          <h2 className="text-sm font-semibold">
            {name} <span className="font-normal text-neutral-500">· {rows.length}</span>
          </h2>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <Link
                  href={cardHref(p.set.game.slug, p.set.code, p.collectorNumber)}
                  className="truncate hover:text-accent"
                >
                  {p.card.name} <span className="text-neutral-500">{p.collectorNumber}</span>
                </Link>
                <span className="shrink-0 text-xs text-neutral-500">
                  {withArt.has(p.cardId) ? "uses original art" : "placeholder"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
