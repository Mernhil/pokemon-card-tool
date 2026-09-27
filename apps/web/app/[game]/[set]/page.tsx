import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@tcg-vault/db";
import { mediaUrl } from "@tcg-vault/shared";

export default async function SetCardGridPage({
  params,
}: {
  params: { game: string; set: string };
}) {
  const game = await prisma.game.findUnique({ where: { slug: params.game } });
  if (!game) notFound();

  const set = await prisma.set.findUnique({
    where: { gameId_code: { gameId: game.id, code: decodeURIComponent(params.set) } },
    include: {
      printings: {
        orderBy: { sortNumber: "asc" },
        include: { card: true, rarity: true },
      },
    },
  });
  if (!set) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">
        {game.name} &mdash; {set.name}
      </h1>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
        {set.printings.map((printing) => {
          const number = String(printing.sortNumber).padStart(3, "0");
          return (
            <li key={printing.id}>
              <Link
                href={`/${params.game}/${params.set}/${number}`}
                className="flex flex-col items-center gap-1 rounded-lg border p-2 text-center hover:border-neutral-400"
              >
                {printing.imageKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(printing.imageKey)}
                    alt={printing.card.name}
                    className="aspect-[5/7] w-full rounded object-cover"
                  />
                ) : (
                  <div className="aspect-[5/7] w-full rounded bg-neutral-100" />
                )}
                <span className="text-xs font-medium">{printing.card.name}</span>
                <span className="text-xs text-neutral-500">
                  {printing.collectorNumber}
                  {printing.rarity ? ` · ${printing.rarity.name}` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
