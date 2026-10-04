import { Library } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings, prisma } from "@tcg-vault/db";
import {
  SET_CATEGORY_BADGES,
  priceLanguageLabel,
  isSetCategory,
  sortLanguages,
  BROWSE_LANGUAGES,
  specialSections,
  type SetCategory,
} from "@tcg-vault/shared";
import { SetTile, type SetTileData } from "../../components/set-tile";
import { RestoreScroll } from "../../components/restore-scroll";
import { ButtonLink } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";

/** Games with a manual set picker on the Sync page; others just sync in the background. */
const MANUALLY_SYNCABLE = new Set(["pokemon", "yugioh", "one-piece"]);

export default async function GameSetListPage({
  params,
  searchParams,
}: {
  params: { game: string };
  searchParams: { lang?: string; tab?: string };
}) {
  const [game, settings] = await Promise.all([
    prisma.game.findUnique({
      where: { slug: params.game },
      include: {
        sets: {
          orderBy: { releaseDate: "desc" },
          include: { _count: { select: { printings: true } } },
        },
      },
    }),
    getSettings(),
  ]);
  if (!game) notFound();

  // Distinct printings owned per set, for the completion rings.
  const owned = await prisma.collectionItem.findMany({
    where: { variant: { printing: { set: { gameId: game.id } } } },
    select: { variant: { select: { printingId: true, printing: { select: { setId: true } } } } },
  });
  const ownedBySet = new Map<number, Set<string>>();
  for (const o of owned) {
    const set = ownedBySet.get(o.variant.printing.setId) ?? new Set<string>();
    set.add(o.variant.printingId);
    ownedBySet.set(o.variant.printing.setId, set);
  }

  const categoryOf = (set: { category: string }): SetCategory =>
    isSetCategory(set.category) ? set.category : "main";
  // One language at a time (English unless asked): every language is a full set of sets.
  const languageOf = (s: { primaryLangCode: string | null }) => s.primaryLangCode ?? "en";
  const setLanguages = sortLanguages([...new Set(game.sets.map(languageOf))]).filter(
    (c) => (BROWSE_LANGUAGES as readonly string[]).includes(c),
  );
  const lang =
    searchParams.lang && setLanguages.includes(searchParams.lang) ? searchParams.lang : "en";
  const visibleSets = game.sets.filter(
    (s) =>
      (settings.showPocketSets || categoryOf(s) !== "pocket") &&
      (setLanguages.length < 2 || languageOf(s) === lang),
  );
  const tile = (set: (typeof game.sets)[number]): SetTileData => ({
    id: set.id,
    code: set.code,
    name: set.name,
    logoUrl: set.logoUrl,
    releaseYear: set.releaseDate ? set.releaseDate.getFullYear() : null,
    cards: set._count.printings,
    owned: ownedBySet.get(set.id)?.size ?? 0,
    badge: SET_CATEGORY_BADGES[categoryOf(set)],
  });

  // Two tabs per language: the main sets in release order, and the promos / special sets.
  const isSpecial = (s: { category: string }) => categoryOf(s) !== "main";
  const hasSpecial = (code: string) =>
    game.sets.some(
      (s) =>
        languageOf(s) === code &&
        isSpecial(s) &&
        (settings.showPocketSets || categoryOf(s) !== "pocket"),
    );
  const tab = searchParams.tab === "special" && hasSpecial(lang) ? "special" : "main";
  const mainSets = visibleSets.filter((s) => !isSpecial(s));
  const specialSets = visibleSets.filter(isSpecial);
  const tabSets = tab === "main" ? mainSets : specialSets;
  const tabs = setLanguages.flatMap((code) => [
    { code, kind: "main" as const },
    ...(hasSpecial(code) ? [{ code, kind: "special" as const }] : []),
  ]);
  const tabHref = (code: string, kind: "main" | "special") => {
    const q = new URLSearchParams();
    if (code !== "en") q.set("lang", code);
    if (kind === "special") q.set("tab", "special");
    const qs = q.toString();
    return qs ? `/${game.slug}?${qs}` : `/${game.slug}`;
  };
  const groups: Array<{ series: string; sets: typeof game.sets }> = [];
  for (const set of tab === "main" ? mainSets : []) {
    const series = set.series ?? "Other";
    const group = groups.find((g) => g.series === series);
    if (group) group.sets.push(set);
    else groups.push({ series, sets: [set] });
  }

  // The special tab: promos, kits and the rest, one headed section per family.
  const counts: Partial<Record<SetCategory, number>> = {};
  for (const set of tab === "special" ? specialSets : [])
    counts[categoryOf(set)] = (counts[categoryOf(set)] ?? 0) + 1;
  const sections = specialSections(counts).map((section) => {
    const sets = specialSets.filter((s) => section.categories.includes(categoryOf(s)));
    const cards = sets.reduce((n, s) => n + s._count.printings, 0);
    const have = sets.reduce((n, s) => n + (ownedBySet.get(s.id)?.size ?? 0), 0);
    return { ...section, sets, cards, have };
  });
  const specialCount = specialSets.length;

  return (
    <main className="page">
      <RestoreScroll />
      <PageHeader
        eyebrow={
          <Link href="/browse" className="hover:underline">
            Browse
          </Link>
        }
        title={game.name}
        subtitle={
          specialCount > 0
            ? `${mainSets.length} main set${mainSets.length === 1 ? "" : "s"} · ${specialCount} special`
            : `${mainSets.length} synced set${mainSets.length === 1 ? "" : "s"}`
        }
        actions={
          MANUALLY_SYNCABLE.has(game.slug) ? (
            <ButtonLink
              href={`/sync?game=${encodeURIComponent(game.slug)}`}
              variant="secondary"
              size="sm"
            >
              Add sets
            </ButtonLink>
          ) : null
        }
      />

      {tabs.length > 1 ? (
        <nav aria-label="Language and set type" className="mb-5 flex flex-wrap gap-1.5 text-xs">
          {tabs.map(({ code, kind }) => {
            const active = code === lang && kind === tab;
            return (
              <Link
                key={`${code}:${kind}`}
                href={tabHref(code, kind)}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1 ${active ? "border-accent bg-accent-soft font-semibold" : "text-neutral-500 hover:text-neutral-900"}`}
              >
                {priceLanguageLabel(code)}
                {kind === "special" ? " · promos & special" : ""}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {tabSets.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No sets synced yet"
          action={
            MANUALLY_SYNCABLE.has(game.slug) ? (
              <ButtonLink href={`/sync?game=${encodeURIComponent(game.slug)}`}>
                Sync some sets
              </ButtonLink>
            ) : undefined
          }
        >
          {MANUALLY_SYNCABLE.has(game.slug)
            ? "Pick a few sets on the Sync page to download them."
            : "Sets sync automatically in the background — check back soon."}
        </EmptyState>
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.series} className="mb-10">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                {group.series}
              </h2>
              <ul className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {group.sets.map((set) => (
                  <li key={set.id}>
                    <SetTile game={game.slug} set={tile(set)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {sections.map((section) => (
            <section key={section.key} className="mb-10">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                {section.label}
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {section.sets.length} set{section.sets.length === 1 ? "" : "s"} · {section.have}/{section.cards} cards
                </span>
              </h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {section.sets.map((set) => (
                  <li key={set.id}>
                    <SetTile game={game.slug} set={tile(set)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
