import Link from "next/link";
import { notFound } from "next/navigation";
import { latestValuations, prisma } from "@tcg-vault/db";
import { CardImage } from "../../../components/card-image";
import { FinishBadge, PriceChip, formatEur } from "../../../components/money";
import { cardHref, sortByFinish } from "../../../lib/cards";

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
        orderBy: [{ sortNumber: "asc" }, { collectorNumber: "asc" }],
        include: { card: true, rarity: true, variants: true },
      },
    },
  });
  if (!set) notFound();

  const values = await latestValuations(set.printings.flatMap((p) => p.variants.map((v) => v.id)));
  const setValue = set.printings.reduce((sum, p) => {
    const prices = p.variants.map((v) => values.get(v.id)?.valueEur ?? 0);
    return sum + Math.max(0, ...prices);
  }, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <p className="text-sm text-neutral-500">
        <Link href={`/${game.slug}`} className="hover:underline">
          {game.name}
        </Link>
        {set.series ? ` · ${set.series}` : ""}
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{set.name}</h1>
        <p className="text-sm text-neutral-500">
          {set.printings.length} cards
          {setValue > 0 ? ` · master set ≈ ${formatEur(setValue)}` : ""}
        </p>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
        {set.printings.map((printing) => {
          const variants = sortByFinish(printing.variants);
          const prices = variants
            .map((v) => values.get(v.id)?.valueEur)
            .filter((v): v is number => v !== undefined);
          const fromPrice = prices.length > 0 ? Math.min(...prices) : null;
          return (
            <li key={printing.id}>
              <Link
                href={cardHref(game.slug, set.code, printing.collectorNumber)}
                className="flex h-full flex-col items-center gap-1 rounded-lg border p-2 text-center hover:border-neutral-400"
              >
                <CardImage
                  imageKey={printing.imageKey}
                  name={printing.card.name}
                  number={printing.collectorNumber}
                />
                <span className="text-xs font-medium">{printing.card.name}</span>
                <span className="text-xs text-neutral-500">
                  {printing.collectorNumber}
                  {printing.rarity ? ` · ${printing.rarity.name}` : ""}
                </span>
                <span className="flex flex-wrap justify-center gap-1">
                  {variants
                    .filter((v) => v.finish !== "NON_FOIL")
                    .map((v) => (
                      <FinishBadge key={v.id} finish={v.finish} />
                    ))}
                </span>
                <span className="mt-auto pt-1">
                  <PriceChip value={fromPrice} prefix={prices.length > 1 ? "from " : ""} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
