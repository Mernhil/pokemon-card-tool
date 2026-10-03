import Link from "next/link";
import { getSettings, prisma } from "@tcg-vault/db";
import { priceLanguageLabel } from "@tcg-vault/shared";
import { PageHeader } from "../../components/ui/page-header";
import { cardHref } from "../../lib/cards";

export const dynamic = "force-dynamic";

const PROMOS = "promos";

/**
 * Printings the catalog has no scan address for, per set, in tabs like the
 * language tabs on a game page: main sets of each language, and one tab for
 * promos, events and other special sets. DB only: nothing is fetched. For a
 * probe of the addresses themselves see `pnpm db:image-report`.
 */
export default async function MissingImagesPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const settings = await getSettings();
  const printings = await prisma.printing.findMany({
    where: {
      customImageKey: null,
      OR: [{ imageUrls: null }, { imageUrls: "[]" }],
      ...(settings.showPocketSets ? {} : { set: { category: { not: "pocket" } } }),
    },
    orderBy: [{ setId: "asc" }, { sortNumber: "asc" }],
    include: { card: true, set: { include: { game: true } } },
  });

  // Tab of a printing: "promos" for every non-main set, else its set's language.
  const tabOf = (p: (typeof printings)[number]) =>
    p.set.category === "main" ? (p.set.primaryLangCode ?? "en") : PROMOS;
  const counts = new Map<string, number>();
  for (const p of printings) counts.set(tabOf(p), (counts.get(tabOf(p)) ?? 0) + 1);
  // English first, then other languages by name, promos last; English always shown.
  const tabs = [...new Set(["en", ...counts.keys()])].sort((a, b) =>
    a === PROMOS ? 1 : b === PROMOS ? -1 : a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b),
  );
  const tab = searchParams.tab && tabs.includes(searchParams.tab) ? searchParams.tab : "en";
  const label = (t: string) => (t === PROMOS ? "Promos & events" : `${priceLanguageLabel(t)} sets`);

  const shown = printings.filter((p) => tabOf(p) === tab);
  const bySet = new Map<string, { name: string; rows: typeof printings }>();
  for (const p of shown) {
    const key = `${p.set.game.slug}/${p.set.code}`;
    if (!bySet.has(key)) bySet.set(key, { name: p.set.name, rows: [] });
    bySet.get(key)!.rows.push(p);
  }

  return (
    <main className="page">
      <PageHeader eyebrow="Catalog" title="Cards without a scan" />
      <p className="mb-4 text-sm text-neutral-500">
        {printings.length === 0
          ? "Every card has a scan address."
          : `${printings.length} cards have no scan from any source. They show an "image not available" tile.`}
      </p>
      <nav aria-label="Group" className="mb-5 flex flex-wrap gap-1.5 text-xs">
        {tabs.map((t) => (
          <Link
            key={t}
            href={t === "en" ? "/missing-images" : `/missing-images?tab=${encodeURIComponent(t)}`}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${t === tab ? "border-accent bg-accent-soft font-semibold" : "text-neutral-500 hover:text-neutral-900"}`}
          >
            {label(t)} <span className="tabular-nums text-neutral-400">{counts.get(t) ?? 0}</span>
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          Every card in this tab has a scan address.
        </p>
      ) : null}
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
