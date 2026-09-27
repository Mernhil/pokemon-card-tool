import { prisma } from "@tcg-vault/db";

export default async function GameSetListPage({ params }: { params: { game: string } }) {
  const game = await prisma.game.findUnique({
    where: { slug: params.game },
    include: { sets: { orderBy: { releaseDate: "desc" } } },
  });

  if (!game) {
    return <main className="mx-auto max-w-5xl px-4 py-16">Unknown game.</main>;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">{game.name} sets</h1>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {game.sets.map((set) => (
          <li key={set.id} className="rounded-lg border p-4">
            {set.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
