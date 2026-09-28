import { prisma } from "@tcg-vault/db";
import { TcgdexPokemonAdapter } from "@tcg-vault/sources";
import { PageHeader } from "../../components/ui/page-header";
import { CatalogStatusPanel } from "./catalog-status";
import { SyncPanel } from "./sync-forms";

export const dynamic = "force-dynamic";

async function loadAvailableSets() {
  try {
    return { sets: await new TcgdexPokemonAdapter().listSetSummaries(), error: null };
  } catch (err) {
    return { sets: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function SyncPage() {
  const [synced, available] = await Promise.all([
    prisma.set.findMany({
      where: { game: { slug: "pokemon" } },
      orderBy: { releaseDate: "desc" },
      include: { _count: { select: { printings: true } } },
    }),
    loadAvailableSets(),
  ]);

  return (
    <main className="page max-w-4xl">
      <PageHeader
        eyebrow="Catalog & prices"
        title="Sync"
        subtitle={
          <>
            Card data and market prices (Cardmarket &amp; TCGplayer) come from{" "}
            <a
              href="https://tcgdex.dev"
              className="text-accent underline"
              target="_blank"
              rel="noreferrer"
            >
              TCGdex
            </a>
            . Every set is synced automatically in the background, newest first; pick sets below to
            sync them right away. Pokémon, English only for now. Needs an internet connection.
          </>
        }
      />
      {available.error ? (
        <p className="panel mb-6 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Couldn&apos;t load the set list from TCGdex ({available.error}). You can still type set
          codes below.
        </p>
      ) : null}
      <div className="mb-6">
        <CatalogStatusPanel />
      </div>
      <SyncPanel
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
