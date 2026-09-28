import { Library } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@tcg-vault/db";
import { ButtonLink } from "../../components/ui/button";
import { CompletionRing } from "../../components/ui/completion-ring";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";

export default async function GameSetListPage({ params }: { params: { game: string } }) {
  const game = await prisma.game.findUnique({
    where: { slug: params.game },
    include: {
      sets: {
        orderBy: { releaseDate: "desc" },
        include: { _count: { select: { printings: true } } },
      },
    },
  });
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

  // Group by series, keeping newest-first order.
  const groups: Array<{ series: string; sets: typeof game.sets }> = [];
  for (const set of game.sets) {
    const series = set.series ?? "Other";
    const group = groups.find((g) => g.series === series);
    if (group) group.sets.push(set);
    else groups.push({ series, sets: [set] });
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow={
          <Link href="/browse" className="hover:underline">
            Browse
          </Link>
        }
        title={game.name}
        subtitle={`${game.sets.length} synced set${game.sets.length === 1 ? "" : "s"}`}
        actions={
          game.slug === "pokemon" ? (
            <ButtonLink href="/sync" variant="secondary" size="sm">
              Add sets
            </ButtonLink>
          ) : null
        }
      />

      {game.sets.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No sets synced yet"
          action={
            game.slug === "pokemon" ? (
              <ButtonLink href="/sync">Sync some sets</ButtonLink>
            ) : undefined
          }
        >
          {game.slug === "pokemon"
            ? "Pick a few sets on the Sync page to download them."
            : "Only Pokémon can be synced for now."}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.series} className="mb-10">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
              {group.series}
            </h2>
            <ul className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {group.sets.map((set) => (
                <li key={set.id}>
                  <Link
                    href={`/${game.slug}/${encodeURIComponent(set.code)}`}
                    className="panel card-tile flex h-full flex-col gap-3 p-4"
                  >
                    <div className="flex h-16 items-center justify-center">
                      {set.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={set.logoUrl}
                          alt=""
                          className="max-h-16 max-w-full object-contain drop-shadow"
                        />
                      ) : (
                        <span className="font-display text-xl font-semibold text-neutral-400">
                          {set.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{set.name}</p>
                        <p className="text-xs text-neutral-500">
                          {set.releaseDate ? set.releaseDate.getFullYear() : "—"} ·{" "}
                          {set._count.printings} cards
                        </p>
                      </div>
                      <CompletionRing
                        owned={ownedBySet.get(set.id)?.size ?? 0}
                        total={set._count.printings}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
