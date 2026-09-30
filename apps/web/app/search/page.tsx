import Link from "next/link";
import { findPokemonByName, latestValuations, prisma, type Prisma } from "@tcg-vault/db";
import {
  RARITY_TIERS,
  RARITY_TIER_LABELS,
  SET_CATEGORIES,
  SET_CATEGORY_LABELS,
  computeTotals,
  hasRarityTiers,
  isRarityTier,
  rarityTier,
  type CostCard,
} from "@tcg-vault/shared";
import { SearchResults, type SearchTile } from "../../components/search-results";
import { RestoreScroll } from "../../components/restore-scroll";
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
  const tier = isRarityTier(searchParams.tier) ? searchParams.tier : undefined;
  // dex=0: the user chose the plain text search over the exact-Pokémon match.
  const plainText = searchParams.dex === "0";
  const sort: Sort = (searchParams.sort as Sort) in SORTS ? (searchParams.sort as Sort) : "value";
  const page = Math.max(1, Number(searchParams.page) || 1);

  const [sets, rarities, languages] = await Promise.all([
    prisma.set.findMany({
      orderBy: { releaseDate: "desc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.rarity.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, game: { select: { slug: true } } },
    }),
    // Only languages some synced card actually exists in.
    prisma.language.findMany({ where: { variants: { some: {} } }, orderBy: { name: "asc" } }),
  ]);

  // "Jirachi" is exactly a Pokémon: list all its cards by National Dex id (Jirachi ex, V, ...),
  // never a prefix match ("Mew" must not bring Mewtwo). Anything else is the contains search.
  const pokemon = q && !plainText ? await findPokemonByName(q) : null;
  const tierRarityIds = tier
    ? rarities.filter((r) => rarityTier(r.game.slug, r.name) === tier).map((r) => r.id)
    : null;

  const where: Prisma.PrintingWhereInput = {
    ...(pokemon
      ? { card: { dex: { some: { dexId: pokemon.dexId } }, game: { slug: "pokemon" } } }
      : q
        ? { card: { name: { contains: q } } }
        : {}),
    ...(setId ? { setId } : {}),
    ...(rarityId ? { rarityId } : {}),
    ...(tierRarityIds ? { AND: [{ rarityId: { in: tierRarityIds } }] } : {}),
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

  // Valuations in chunks: a wide search can have tens of thousands of variants.
  const allVariantIds = printings.flatMap((p) => p.variants.map((v) => v.id));
  const values = new Map<string, { valueEur: number; valueUsd: number; day: Date }>();
  for (let i = 0; i < allVariantIds.length; i += 5_000) {
    for (const [id, v] of await latestValuations(allVariantIds.slice(i, i + 5_000)))
      values.set(id, v);
  }
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
    if (tier) params.set("tier", tier);
    if (plainText) params.set("dex", "0");
    if (sort !== "value") params.set("sort", sort);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  };

  const select = "field";
  // Owned copies for every result (one query via the same filter), for the cost summary.
  const owned = await prisma.collectionItem.groupBy({
    by: ["variantId"],
    where: { variant: { printing: where } },
    _sum: { quantity: true },
  });
  const ownedByVariant = new Map(owned.map((o) => [o.variantId, o._sum.quantity ?? 0]));

  // What the summary counts: each result's variants in the chosen finish / language, valued in the
  // price language (valuations). Computed once here for ALL results, not per tile or per page.
  const summary: CostCard[] = printings.map((p) => ({
    id: p.id,
    variants: p.variants
      .filter((v) => (!finish || v.finish === finish) && (!lang || v.languageCode === lang))
      .map((v) => ({
        value: values.get(v.id)?.valueEur ?? null,
        owned: (ownedByVariant.get(v.id) ?? 0) > 0,
      })),
  }));
  const initialTotals = computeTotals(summary, "cheapest");
  const tiles: SearchTile[] = shown.map((p) => {
    const best = bestValue(p);
    return {
      id: p.id,
      href: cardHref(p.set.game.slug, p.set.code, p.collectorNumber),
      imageKey: p.imageKey,
      name: p.card.name,
      number: p.collectorNumber,
      subtitle: `${p.set.name} · ${p.collectorNumber}`,
      finishes: sortByFinish(p.variants).map((v) => v.finish),
      price: best >= 0 ? best : null,
      owned: p.variants.reduce((sum, v) => sum + (ownedByVariant.get(v.id) ?? 0), 0),
    };
  });
  // The remembered selection belongs to one search: every filter except the page.
  const scope = pageHref(1).split("?")[1] ?? "";
  const chipHref = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(pageHref(1).split("?")[1] ?? "");
    params.delete("page");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-accent bg-accent-soft text-neutral-900"
        : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
    }`;
  const showTiers = rarities.some((r) => hasRarityTiers(r.game.slug));

  return (
    <main className="page">
      <RestoreScroll />
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

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Quick filters">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Type</span>
          {(
            [
              [null, "All"],
              ["NON_FOIL", "Normal"],
              ["REVERSE_HOLO", "Reverse holo"],
              ["HOLO", "Holo"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={label}
              href={chipHref({ finish: value })}
              className={chip((finish ?? null) === value)}
            >
              {label}
            </Link>
          ))}
        </div>
        {showTiers ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500">Rarity</span>
            <Link href={chipHref({ tier: null })} className={chip(!tier)}>
              Any
            </Link>
            {RARITY_TIERS.map((t) => (
              <Link key={t} href={chipHref({ tier: t })} className={chip(tier === t)}>
                {RARITY_TIER_LABELS[t]}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {printings.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">No cards match.</p>
      ) : (
        <SearchResults
          tiles={tiles}
          summary={summary}
          initialTotals={initialTotals}
          scope={scope}
          pokemon={
            pokemon
              ? { dexId: pokemon.dexId, name: pokemon.name, textHref: chipHref({ dex: "0" }) }
              : null
          }
        />
      )}

      {pageCount > 1 ? (
        <nav
          className="mt-6 flex items-center justify-center gap-3 text-sm"
          aria-label="Pagination"
        >
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
