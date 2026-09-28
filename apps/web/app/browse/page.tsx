import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { prisma } from "@tcg-vault/db";
import { ButtonLink } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/page-header";

// No DATABASE_URL at build time (only set at runtime by the desktop sidecar) —
// prerendering this page would fail, so it must render on request instead.
export const dynamic = "force-dynamic";

/** Games that can be synced today; the others show as "coming soon". */
const SYNCABLE = new Set(["pokemon", "yugioh", "one-piece"]);

export default async function BrowsePage() {
  const games = await prisma.game.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sets: true, cards: true } } },
  });
  const empty = games.every((g) => g._count.cards === 0);

  return (
    <main className="page">
      <PageHeader eyebrow="Catalog" title="Browse" subtitle="Pick a game to see its sets." />
      {empty ? (
        <div className="panel mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>
            The catalog is empty — sync a couple of sets to download cards, images and prices.
          </span>
          <ButtonLink href="/sync" size="sm">
            Go to Sync
          </ButtonLink>
        </div>
      ) : null}
      <ul className="stagger grid grid-cols-1 gap-5 sm:grid-cols-3">
        {games.map((game) => {
          const syncable = SYNCABLE.has(game.slug);
          return (
            <li key={game.id}>
              <Link
                href={`/${game.slug}`}
                className={`panel card-tile group relative flex h-40 flex-col justify-between overflow-hidden p-6 ${
                  syncable ? "" : "opacity-60"
                }`}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-accent/10 blur-2xl transition-transform duration-500 group-hover:scale-150"
                />
                <span className="font-display text-2xl font-semibold">{game.name}</span>
                <span className="flex items-end justify-between text-sm text-neutral-500">
                  <span>
                    {game._count.sets} set{game._count.sets === 1 ? "" : "s"} · {game._count.cards}{" "}
                    card
                    {game._count.cards === 1 ? "" : "s"}
                    {syncable ? null : (
                      <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                        Coming soon
                      </span>
                    )}
                  </span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
