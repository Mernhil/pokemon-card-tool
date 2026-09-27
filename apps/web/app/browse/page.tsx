import Link from "next/link";
import { prisma } from "@tcg-vault/db";

// No DATABASE_URL at build time (only set at runtime by the desktop sidecar) —
// prerendering this page would fail, so it must render on request instead.
export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const games = await prisma.game.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sets: true, cards: true } } },
  });

  const empty = games.every((g) => g._count.cards === 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Browse the catalog</h1>
      {empty ? (
        <p className="mt-4 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-900 dark:text-amber-200">
          The catalog is empty.{" "}
          <Link href="/sync" className="font-medium underline">
            Go to Sync
          </Link>{" "}
          and pick a couple of sets to download cards, images and prices.
        </p>
      ) : null}
      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {games.map((game) => (
          <li key={game.id}>
            <Link
              href={`/${game.slug}`}
              className="block rounded-lg border p-6 hover:border-neutral-400"
            >
              <p className="text-lg font-medium">{game.name}</p>
              <p className="mt-1 text-sm text-neutral-500">
                {game._count.sets} set{game._count.sets === 1 ? "" : "s"} · {game._count.cards} card
                {game._count.cards === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
