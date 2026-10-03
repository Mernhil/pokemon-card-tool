import Link from "next/link";
import { priceCoverage } from "@tcg-vault/db";
import { cardHref } from "../../lib/cards";
import { finishLabel } from "../../components/money";
import { PageHeader } from "../../components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Pokémon variants no price source has ever priced, per set. DB only: nothing
 * is fetched. The same list as a spreadsheet: `pnpm db:price-report -- --csv out.csv`.
 */
export default async function MissingPricesPage() {
  const report = await priceCoverage("pokemon");
  const bySet = new Map<string, { name: string; total: number; rows: typeof report.variants }>();
  for (const v of report.variants) {
    if (!bySet.has(v.setCode)) {
      const s = report.sets.find((x) => x.setCode === v.setCode);
      bySet.set(v.setCode, { name: v.setName, total: s?.total ?? 0, rows: [] });
    }
    bySet.get(v.setCode)!.rows.push(v);
  }
  const ordered = [...bySet.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length);

  return (
    <main className="page">
      <PageHeader eyebrow="Catalog" title="Cards without a price" />
      <p className="mb-6 text-sm text-neutral-500">
        {report.unpriced === 0
          ? "Every card has at least one price."
          : `${report.unpriced} of ${report.total} Pokémon variants have no price from any source yet. Prices arrive when a card is in your collection or has been opened, so a new catalog starts mostly empty; the sets at the top are the biggest real gaps.`}
      </p>
      {ordered.map(([code, { name, total, rows }]) => (
        <section key={code} className="panel mb-4 p-4">
          <h2 className="text-sm font-semibold">
            {name}{" "}
            <span className="font-normal text-neutral-500">
              · {rows.length} of {total}
            </span>
          </h2>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {rows.slice(0, 60).map((v) => (
              <li key={v.variantId} className="truncate">
                <Link href={cardHref(v.gameSlug, v.setCode, v.collectorNumber)} className="hover:text-accent">
                  {v.cardName} <span className="text-neutral-500">{v.collectorNumber}</span>
                </Link>{" "}
                <span className="text-xs text-neutral-400">{finishLabel(v.finish)}</span>
              </li>
            ))}
          </ul>
          {rows.length > 60 ? (
            <p className="mt-2 text-xs text-neutral-500">…and {rows.length - 60} more (see the CSV).</p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
