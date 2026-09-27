import { prisma } from "@tcg-vault/db";
import { TcgdexPokemonAdapter } from "@tcg-vault/sources";
import { AddSetsForm, RefreshPricesForm } from "./sync-forms";

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
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Sync catalog &amp; prices</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Cards, images and market prices (Cardmarket &amp; TCGplayer) come from{" "}
        <a href="https://tcgdex.dev" className="underline" target="_blank" rel="noreferrer">
          TCGdex
        </a>
        . Pokémon, English only for now. Needs an internet connection.
      </p>

      <section className="mt-8">
        <h2 className="font-semibold">Synced sets ({synced.length})</h2>
        {synced.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nothing synced yet — add a set below.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {synced.map((s) => (
              <li key={s.id} className="rounded border px-2 py-1">
                {s.name} <span className="text-neutral-400">· {s._count.printings} cards</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <RefreshPricesForm hasSets={synced.length > 0} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-semibold">Add sets</h2>
        {available.error ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
            Couldn&apos;t load the set list from TCGdex ({available.error}). You can still type set
            codes below.
          </p>
        ) : null}
        <div className="mt-3">
          <AddSetsForm available={available.sets} synced={synced.map((s) => s.code)} />
        </div>
      </section>
    </main>
  );
}
