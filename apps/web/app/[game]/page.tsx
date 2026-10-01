import { Library } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings, prisma } from "@tcg-vault/db";
import {
  SET_CATEGORY_BADGES,
  priceLanguageLabel,
  isSetCategory,
  specialSections,
  type SetCategory,
} from "@tcg-vault/shared";
import { CollapsibleSection } from "../../components/collapsible-section";
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
  searchParams: { lang?: string };
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
  const setLanguages = [...new Set(game.sets.map(languageOf))].sort((a, b) =>
    a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b),
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

  // Main sets grouped by series, keeping newest-first order.
  const mainSets = visibleSets.filter((s) => categoryOf(s) === "main");
  const groups: Array<{ series: string; sets: typeof game.sets }> = [];
  for (const set of mainSets) {
    const series = set.series ?? "Other";
    const group = groups.find((g) => g.series === series);
    if (group) group.sets.push(set);
    else groups.push({ series, sets: [set] });
  }

  // Everything else in collapsible sections below (families of 3+ sets get their own).
  const counts: Partial<Record<SetCategory, number>> = {};
  for (const set of visibleSets) counts[categoryOf(set)] = (counts[categoryOf(set)] ?? 0) + 1;
  const sections = specialSections(counts).map((section) => {
    const sets = visibleSets.filter((s) => section.categories.includes(categoryOf(s)));
    const cards = sets.reduce((n, s) => n + s._count.printings, 0);
    const have = sets.reduce((n, s) => n + (ownedBySet.get(s.id)?.size ?? 0), 0);
    return { ...section, sets, cards, have };
  });
  const specialCount = sections.reduce((n, s) => n + s.sets.length, 0);

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

      {setLanguages.length > 1 ? (
        <nav aria-label="Card language" className="mb-5 flex flex-wrap gap-1.5 text-xs">
          {setLanguages.map((code) => (
            <Link
              key={code}
              href={code === "en" ? `/${game.slug}` : `/${game.slug}?lang=${code}`}
              aria-current={code === lang ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${code === lang ? "border-accent bg-accent-soft font-semibold" : "text-neutral-500 hover:text-neutral-900"}`}
            >
              {priceLanguageLabel(code)}
            </Link>
          ))}
        </nav>
      ) : null}

      {visibleSets.length === 0 ? (
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
            <CollapsibleSection
              key={section.key}
              storageKey={`set-section:${game.slug}:${section.key}`}
              title={section.label}
              summary={`${section.sets.length} set${section.sets.length === 1 ? "" : "s"} · ${section.have}/${section.cards} cards`}
            >
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {section.sets.map((set) => (
                  <li key={set.id}>
                    <SetTile game={game.slug} set={tile(set)} />
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          ))}
        </>
      )}
    </main>
  );
}
