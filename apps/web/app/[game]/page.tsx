import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@tcg-vault/db";

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

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">{game.name} sets</h1>
      {game.sets.length === 0 ? (
        <p className="mt-6 text-neutral-500">
          No sets synced yet for this game.{" "}
          {game.slug === "pokemon" ? (
            <Link href="/sync" className="underline">
              Sync some sets
            </Link>
          ) : (
            "Only Pokémon can be synced for now."
          )}
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {game.sets.map((set) => (
            <li key={set.id}>
              <Link
                href={`/${game.slug}/${encodeURIComponent(set.code)}`}
                className="flex h-full flex-col items-center gap-2 rounded-lg border p-4 text-center hover:border-neutral-400"
              >
                {set.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={set.logoUrl} alt="" className="h-10 max-w-full object-contain" />
                ) : null}
                <span className="font-medium">{set.name}</span>
                <span className="text-xs text-neutral-500">
                  {set._count.printings} card{set._count.printings === 1 ? "" : "s"}
                  {set.releaseDate ? ` · ${set.releaseDate.getFullYear()}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
