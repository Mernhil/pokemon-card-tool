import Link from "next/link";
import { livingPokedex } from "@tcg-vault/db";
import { CardImage } from "../../components/card-image";
import { CompletionRing } from "../../components/ui/completion-ring";
import { PageHeader } from "../../components/ui/page-header";
import { cardHref } from "../../lib/cards";

export const dynamic = "force-dynamic";

/** Goal: one card of every Pokémon, by generation. Owning any card of a Pokémon ticks it. */
export default async function PokedexPage() {
  const dex = await livingPokedex();
  return (
    <main className="page">
      <PageHeader
        eyebrow="Goals"
        title="Living Pokédex"
        subtitle="One card of every Pokémon, any set, finish or language. A Pokémon counts as soon as you own a card of it."
      />
      <div className="panel mb-6 flex items-center gap-4 px-5 py-3">
        <CompletionRing owned={dex.owned} total={dex.total} size={56} />
        <div>
          <p className="text-sm font-semibold">
            {dex.owned} / {dex.total} Pokémon
          </p>
          <p className="text-xs text-neutral-500">
            {dex.total === 0
              ? "The catalog has no Pokédex numbers yet. They arrive with the Pokémon catalog sync."
              : `${dex.total - dex.owned} still to find`}
          </p>
        </div>
      </div>
      {dex.generations
        .filter((g) => g.entries.length > 0)
        .map((g) => (
          <section key={g.gen} className="mb-8">
            <h2 className="mb-3 flex items-center gap-3 text-sm font-semibold">
              <CompletionRing owned={g.owned} total={g.entries.length} size={28} />
              Generation {g.gen} · {g.name}
              <span className="font-normal text-neutral-500">
                {g.owned} / {g.entries.length}
              </span>
            </h2>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-10">
              {g.entries.map((e) => (
                <li key={e.dexId}>
                  <Link
                    href={
                      e.sample
                        ? cardHref("pokemon", e.sample.setCode, e.sample.collectorNumber)
                        : `/search?q=${encodeURIComponent(e.name)}`
                    }
                    title={e.copies > 0 ? `${e.name}: you own ${e.copies}` : `${e.name}: not yet`}
                    className={`panel flex h-full flex-col items-center gap-1 p-1.5 text-center text-[11px] ${
                      e.copies > 0 ? "ring-1 ring-accent/50" : "opacity-60 hover:opacity-100"
                    }`}
                  >
                    {e.sample ? (
                      <CardImage
                        imageKey={e.sample.imageKey}
                        name={e.sample.cardName}
                        number={e.sample.collectorNumber}
                      />
                    ) : (
                      <span className="grid aspect-[5/7] w-full place-items-center rounded-md bg-surface-2 text-lg font-semibold tabular-nums text-neutral-400">
                        {e.dexId}
                      </span>
                    )}
                    <span className="line-clamp-1 font-medium text-neutral-800">{e.name}</span>
                    <span className="tabular-nums text-neutral-400">#{e.dexId}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </main>
  );
}
