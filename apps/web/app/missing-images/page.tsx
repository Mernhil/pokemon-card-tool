import Link from "next/link";
import { prisma } from "@tcg-vault/db";
import { cardHref } from "../../lib/cards";
import { PageHeader } from "../../components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Printings the catalog has no scan address for, per set.
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

  const bySet = new Map<string, { name: string; rows: typeof printings }>();
  for (const p of printings) {
    const key = `${p.set.game.slug}/${p.set.code}`;
    if (!bySet.has(key)) bySet.set(key, { name: p.set.name, rows: [] });
    bySet.get(key)!.rows.push(p);
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Catalog" title="Cards without a scan" />
      <p className="mb-6 text-sm text-neutral-500">
        {printings.length === 0
          ? "Every card has a scan address."
          : `${printings.length} cards have no scan from any source. They show an "image not available" tile.`}
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
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
