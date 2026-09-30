import Link from "next/link";
import { latestValuations, prisma, type Prisma } from "@tcg-vault/db";
import { SET_CATEGORIES, SET_CATEGORY_LABELS } from "@tcg-vault/shared";
import { CardTile } from "../../components/card-tile";
import { finishLabel } from "../../components/money";
import { buttonClass } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";
import { cardHref, sortByFinish } from "../../lib/cards";
import { loadMoneyDisplay } from "../../lib/money-config";

export const dynamic = "force-dynamic";

const LIMIT = 120;
const SORTS = { value: "Highest value", name: "Name", number: "Set & number" } as const;
type Sort = keyof typeof SORTS;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  await loadMoneyDisplay();
  const q = searchParams.q?.trim() ?? "";
  const setId = searchParams.set ? Number(searchParams.set) : undefined;
  const rarityId = searchParams.rarity ? Number(searchParams.rarity) : undefined;
  const finish = searchParams.finish || undefined;
  const owned_ = searchParams.owned === "1";
  const lang = searchParams.lang || undefined;
  const sort: Sort = (searchParams.sort as Sort) in SORTS ? (searchParams.sort as Sort) : "value";
  const page = Math.max(1, Number(searchParams.page) || 1);

  const [sets, rarities, languages] = await Promise.all([
    prisma.set.findMany({
      orderBy: { releaseDate: "desc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.rarity.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Only languages some synced card actually exists in.
    prisma.language.findMany({ where: { variants: { some: {} } }, orderBy: { name: "asc" } }),
  ]);

  const where: Prisma.PrintingWhereInput = {
    ...(q ? { card: { name: { contains: q } } } : {}),
    ...(setId ? { setId } : {}),
    ...(rarityId ? { rarityId } : {}),
    ...(finish || owned_ || lang
      ? {
          variants: {
            some: {
              ...(finish ? { finish } : {}),
              ...(lang ? { languageCode: lang } : {}),
              ...(owned_ ? { collection: { some: {} } } : {}),
            },
          },
        }
      : {}),
  };

  const printings = await prisma.printing.findMany({
    where,
    include: {
      card: true,
      rarity: true,
      set: { include: { game: true } },
      variants: true,
    },
    orderBy:
      sort === "name"
        ? [{ card: { name: "asc" } }, { sortNumber: "asc" }]
        : [{ set: { releaseDate: "desc" } }, { sortNumber: "asc" }],
  });

  const values = await latestValuations(printings.flatMap((p) => p.variants.map((v) => v.id)));
  const bestValue = (p: (typeof printings)[number]) =>
    Math.max(-1, ...p.variants.map((v) => values.get(v.id)?.valueEur ?? -1));
  if (sort === "value") printings.sort((a, b) => bestValue(b) - bestValue(a));
  const pageCount = Math.max(1, Math.ceil(printings.length / LIMIT));
  const currentPage = Math.min(page, pageCount);
  const shown = printings.slice((currentPage - 1) * LIMIT, currentPage * LIMIT);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (setId) params.set("set", String(setId));
    if (rarityId) params.set("rarity", String(rarityId));
    if (finish) params.set("finish", finish);
    if (owned_) params.set("owned", "1");
    if (lang) params.set("lang", lang);
    if (sort !== "value") params.set("sort", sort);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  };

  const select = "field";
  const owned = await prisma.collectionItem.groupBy({
    by: ["variantId"],
    where: { variantId: { in: shown.flatMap((p) => p.variants.map((v) => v.id)) } },
    _sum: { quantity: true },
  });
  const ownedByVariant = new Map(owned.map((o) => [o.variantId, o._sum.quantity ?? 0]));

  return (
    <main className="page">
      <PageHeader
        eyebrow="Catalog"
        title="Search"
        subtitle={
          sets.length === 0 ? (
            <>
              The catalog is empty —{" "}
              <Link href="/sync" className="text-accent underline">
                sync some sets
              </Link>{" "}
              first.
            </>
          ) : (
            `${printings.length} result${printings.length === 1 ? "" : "s"}${pageCount > 1 ? ` — page ${currentPage} of ${pageCount}` : ""}`
          )
        }
      />

      <form className="panel mb-6 flex flex-wrap items-end gap-3 p-4" method="get">
        <label className="label min-w-56 flex-1">
          Name
          <input
            name="q"
            defaultValue={q}
            placeholder="Charizard, Pikachu…"
            className={select}
            autoFocus
          />
        </label>
        <label className="label">
          Set
          <select name="set" defaultValue={setId ?? ""} className={select}>
            <option value="">All sets</option>
            {SET_CATEGORIES.map((category) => {
              const inCategory = sets.filter((s) => s.category === category);
              if (inCategory.length === 0) return null;
              const options = inCategory.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ));
              // Main sets first and unlabelled; special sets stay searchable, clearly grouped.
              return category === "main" ? (
                options
              ) : (
                <optgroup key={category} label={SET_CATEGORY_LABELS[category]}>
                  {options}
                </optgroup>
              );
            })}
          </select>
        </label>
        <label className="label">
          Rarity
          <select name="rarity" defaultValue={rarityId ?? ""} className={select}>
            <option value="">Any rarity</option>
            {rarities.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Finish
          <select name="finish" defaultValue={finish ?? ""} className={select}>
            <option value="">Any finish</option>
            {["NON_FOIL", "HOLO", "REVERSE_HOLO"].map((f) => (
              <option key={f} value={f}>
                {finishLabel(f)}
              </option>
            ))}
          </select>
        </label>
        {languages.length > 1 ? (
          <label className="label">
            Language
            <select name="lang" defaultValue={lang ?? ""} className={select}>
              <option value="">Any language</option>
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="label">
          Sort
          <select name="sort" defaultValue={sort} className={select}>
            {Object.entries(SORTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            name="owned"
            value="1"
            defaultChecked={owned_}
            className="accent-[rgb(var(--accent))]"
          />
          Owned only
        </label>
        <button type="submit" className={buttonClass("primary", "md")}>
          Search
        </button>
      </form>

      <ul className="stagger grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {shown.map((p) => {
          const best = bestValue(p);
          return (
            <li key={p.id}>
              <CardTile
                href={cardHref(p.set.game.slug, p.set.code, p.collectorNumber)}
                imageKey={p.imageKey}
                name={p.card.name}
                number={p.collectorNumber}
                subtitle={`${p.set.name} · ${p.collectorNumber}`}
                finishes={sortByFinish(p.variants).map((v) => v.finish)}
                price={best >= 0 ? best : null}
                owned={p.variants.reduce((sum, v) => sum + (ownedByVariant.get(v.id) ?? 0), 0)}
              />
            </li>
          );
        })}
      </ul>

      {pageCount > 1 ? (
        <nav className="mt-6 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {currentPage > 1 ? (
            <Link href={pageHref(currentPage - 1)} className={buttonClass("secondary", "sm")}>
              Previous
            </Link>
          ) : null}
          <span className="text-neutral-500">
            Page {currentPage} of {pageCount}
          </span>
          {currentPage < pageCount ? (
            <Link href={pageHref(currentPage + 1)} className={buttonClass("secondary", "sm")}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
