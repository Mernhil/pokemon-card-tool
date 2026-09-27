import Link from "next/link";
import { latestValuations, prisma, type Prisma } from "@tcg-vault/db";
import { CardImage } from "../../components/card-image";
import { FinishBadge, PriceChip, finishLabel } from "../../components/money";
import { cardHref, sortByFinish } from "../../lib/cards";

export const dynamic = "force-dynamic";

const LIMIT = 120;
const SORTS = { value: "Highest value", name: "Name", number: "Set & number" } as const;
type Sort = keyof typeof SORTS;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const q = searchParams.q?.trim() ?? "";
  const setId = searchParams.set ? Number(searchParams.set) : undefined;
  const rarityId = searchParams.rarity ? Number(searchParams.rarity) : undefined;
  const finish = searchParams.finish || undefined;
  const owned = searchParams.owned === "1";
  const lang = searchParams.lang || undefined;
  const sort: Sort = (searchParams.sort as Sort) in SORTS ? (searchParams.sort as Sort) : "value";

  const [sets, rarities, languages] = await Promise.all([
    prisma.set.findMany({ orderBy: { releaseDate: "desc" }, select: { id: true, name: true } }),
    prisma.rarity.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Only languages some synced card actually exists in.
    prisma.language.findMany({ where: { variants: { some: {} } }, orderBy: { name: "asc" } }),
  ]);

  const where: Prisma.PrintingWhereInput = {
    ...(q ? { card: { name: { contains: q } } } : {}),
    ...(setId ? { setId } : {}),
    ...(rarityId ? { rarityId } : {}),
    ...(finish || owned || lang
      ? {
          variants: {
            some: {
              ...(finish ? { finish } : {}),
              ...(lang ? { languageCode: lang } : {}),
              ...(owned ? { collection: { some: {} } } : {}),
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
  const shown = printings.slice(0, LIMIT);

  const select = "rounded border px-2 py-1 text-sm";

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Search</h1>

      <form className="mt-6 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Name
          <input
            name="q"
            defaultValue={q}
            placeholder="Charizard, Pikachu…"
            className={`${select} w-56`}
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Set
          <select name="set" defaultValue={setId ?? ""} className={select}>
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
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
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
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
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
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
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Sort
          <select name="sort" defaultValue={sort} className={select}>
            {Object.entries(SORTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-sm">
          <input type="checkbox" name="owned" value="1" defaultChecked={owned} />
          Owned only
        </label>
        <button
          type="submit"
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-50 hover:bg-neutral-700"
        >
          Search
        </button>
      </form>

      <p className="mt-6 text-sm text-neutral-500">
        {printings.length} result{printings.length === 1 ? "" : "s"}
        {printings.length > LIMIT ? ` — showing the first ${LIMIT}` : ""}
        {sets.length === 0 ? (
          <>
            {" "}
            · the catalog is empty,{" "}
            <Link href="/sync" className="underline">
              sync some sets
            </Link>{" "}
            first
          </>
        ) : null}
      </p>

      <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
        {shown.map((p) => {
          const best = bestValue(p);
          return (
            <li key={p.id}>
              <Link
                href={cardHref(p.set.game.slug, p.set.code, p.collectorNumber)}
                className="flex h-full flex-col items-center gap-1 rounded-lg border p-2 text-center hover:border-neutral-400"
              >
                <CardImage imageKey={p.imageKey} name={p.card.name} number={p.collectorNumber} />
                <span className="text-xs font-medium">{p.card.name}</span>
                <span className="text-xs text-neutral-500">
                  {p.set.name} · {p.collectorNumber}
                </span>
                <span className="flex flex-wrap justify-center gap-1">
                  {sortByFinish(p.variants)
                    .filter((v) => v.finish !== "NON_FOIL")
                    .map((v) => (
                      <FinishBadge key={v.id} finish={v.finish} />
                    ))}
                </span>
                <span className="mt-auto pt-1">
                  <PriceChip value={best >= 0 ? best : null} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
