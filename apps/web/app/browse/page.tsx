import Link from "next/link";
import { prisma } from "@tcg-vault/db";

export default async function BrowsePage() {
  const games = await prisma.game.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sets: true, cards: true } } },
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Browse the catalog</h1>
      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {games.map((game) => (
          <li key={game.id}>
            <Link
              href={`/${game.slug}`}
              className="block rounded-lg border p-6 hover:border-neutral-400"
            >
              <p className="text-lg font-medium">{game.name}</p>
              <p className="mt-1 text-sm text-neutral-500">
                {game._count.sets} set{game._count.sets === 1 ? "" : "s"} ·{" "}
                {game._count.cards} card{game._count.cards === 1 ? "" : "s"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
