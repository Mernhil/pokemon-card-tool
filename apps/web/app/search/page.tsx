import Link from "next/link";
import { prisma } from "@tcg-vault/db";
import { mediaUrl } from "@tcg-vault/shared";

// No DATABASE_URL at build time (only set at runtime by the desktop sidecar) —
// prerendering this page would fail, so it must render on request instead.
export const dynamic = "force-dynamic";

const RESULT_LIMIT = 60;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string; rarity?: string; finish?: string; lang?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  const rarityId = searchParams.rarity ? Number(searchParams.rarity) : undefined;
  const finish = searchParams.finish || undefined;
  const lang = searchParams.lang || undefined;

  const hasFilters = Boolean(q || rarityId || finish || lang);

  const [rarities, finishes, languages, printings] = await Promise.all([
    prisma.rarity.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.printVariant.findMany({ distinct: ["finish"], select: { finish: true } }),
    prisma.language.findMany({
      where: { variants: { some: {} } },
      orderBy: { name: "asc" },
    }),
    hasFilters
      ? prisma.printing.findMany({
          where: {
            card: q ? { name: { contains: q } } : undefined,
            rarityId,
            variants: finish || lang ? { some: { finish, languageCode: lang } } : undefined,
          },
          orderBy: { card: { name: "asc" } },
          take: RESULT_LIMIT,
          include: {
            card: true,
            rarity: true,
            set: { include: { game: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Search</h1>

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Card name
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Pikachu"
            className="rounded border px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Rarity
          <select name="rarity" defaultValue={searchParams.rarity ?? ""} className="rounded border px-2 py-1">
            <option value="">Any</option>
            {rarities.map((rarity) => (
              <option key={rarity.id} value={rarity.id}>
                {rarity.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Finish
          <select name="finish" defaultValue={finish ?? ""} className="rounded border px-2 py-1">
            <option value="">Any</option>
            {finishes.map(({ finish: value }) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Language
          <select name="lang" defaultValue={lang ?? ""} className="rounded border px-2 py-1">
            <option value="">Any</option>
            {languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Search
        </button>
      </form>

      {!hasFilters ? (
        <p className="mt-8 text-neutral-500">Enter a card name or pick a filter to search the catalog.</p>
      ) : printings.length === 0 ? (
        <p className="mt-8 text-neutral-500">No cards matched your search.</p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {printings.map((printing) => {
            const number = String(printing.sortNumber).padStart(3, "0");
            return (
              <li key={printing.id}>
                <Link
                  href={`/${printing.set.game.slug}/${encodeURIComponent(printing.set.code)}/${number}`}
                  className="flex flex-col items-center gap-1 rounded-lg border p-2 text-center hover:border-neutral-400"
                >
                  {printing.imageKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(printing.imageKey)}
                      alt={printing.card.name}
                      className="aspect-[5/7] w-full rounded object-cover"
                    />
                  ) : (
                    <div className="aspect-[5/7] w-full rounded bg-neutral-100" />
                  )}
                  <span className="text-xs font-medium">{printing.card.name}</span>
                  <span className="text-xs text-neutral-500">
                    {printing.set.name} · {printing.collectorNumber}
                    {printing.rarity ? ` · ${printing.rarity.name}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
