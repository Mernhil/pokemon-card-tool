import Link from "next/link";
import { prisma } from "@tcg-vault/db";
import { catalogAdapters } from "../../lib/background";
import { PageHeader } from "../../components/ui/page-header";
import { CatalogStatusPanel } from "./catalog-status";
import { CardTraderPass } from "./cardtrader-pass";
import { SyncPanel } from "./sync-forms";

export const dynamic = "force-dynamic";

/** Where each source's set list comes from, shown under the tabs. */
const SOURCE_LABELS: Record<string, { name: string; href: string }> = {
  pokemon: { name: "TCGdex", href: "https://tcgdex.dev" },
  yugioh: { name: "YGOPRODeck", href: "https://ygoprodeck.com" },
  "one-piece": { name: "optcgapi.com", href: "https://optcgapi.com" },
};

async function loadAvailableSets(game: string) {
  try {
    const adapter = catalogAdapters().find((a) => a.game === game);
    if (!adapter) return { sets: [], error: `No catalog source for "${game}"` };
    return { sets: await adapter.listSetSummaries(), error: null };
  } catch (err) {
    return { sets: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function SyncPage({ searchParams }: { searchParams: { game?: string } }) {
  const games = await prisma.game.findMany({ orderBy: { name: "asc" } });
  const adapterSlugs = new Set(catalogAdapters().map((a) => a.game));
  const syncableGames = games.filter((g) => adapterSlugs.has(g.slug));
  const game = syncableGames.some((g) => g.slug === searchParams.game)
    ? searchParams.game!
    : (syncableGames[0]?.slug ?? "pokemon");
  const source = SOURCE_LABELS[game];

  const [synced, available] = await Promise.all([
    prisma.set.findMany({
      where: { game: { slug: game } },
      orderBy: { releaseDate: "desc" },
      include: { _count: { select: { printings: true } } },
    }),
    loadAvailableSets(game),
  ]);

  return (
    <main className="page max-w-4xl">
      <PageHeader
        eyebrow="Catalog & prices"
        title="Sync"
        subtitle={
          source ? (
            <>
              Card data comes from{" "}
              <a
                href={source.href}
                className="text-accent underline"
                target="_blank"
                rel="noreferrer"
              >
                {source.name}
              </a>
              . Every set is synced automatically in the background, newest first; pick sets below
              to sync them right away. English only for now. Needs an internet connection.
            </>
          ) : (
            "Every set is synced automatically in the background, newest first; pick sets below to sync them right away. Needs an internet connection."
          )
        }
      />

      <p className="mb-4 text-xs text-neutral-500">
        Missing a card scan no source has?{" "}
        <Link href="/import-images" className="text-accent underline">
          Import images from a folder
        </Link>
        , or use &quot;Set custom image&quot; on the card.
      </p>

      {syncableGames.length > 1 ? (
        <div className="mb-6 flex gap-2 border-b">
          {syncableGames.map((g) => (
            <Link
              key={g.slug}
              href={`/sync?game=${encodeURIComponent(g.slug)}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                g.slug === game
                  ? "border-accent text-accent"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {g.name}
            </Link>
          ))}
        </div>
      ) : null}

      {available.error ? (
        <p className="panel mb-6 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Couldn&apos;t load the set list{source ? ` from ${source.name}` : ""} ({available.error}).
          You can still type set codes below.
        </p>
      ) : null}
      <div className="mb-6">
        <CatalogStatusPanel />
      </div>
      {game === "pokemon" ? <CardTraderPass /> : null}
      <SyncPanel
        game={game}
        synced={synced.map((s) => ({
          code: s.code,
          name: s.name,
          cards: s._count.printings,
          symbolUrl: s.symbolUrl,
        }))}
        available={available.sets}
      />
    </main>
  );
}
