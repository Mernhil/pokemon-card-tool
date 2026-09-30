import Link from "next/link";
import { notFound } from "next/navigation";
import { latestValuations, prisma } from "@tcg-vault/db";
import { subsetsForSet } from "@tcg-vault/shared";
import { formatEur } from "../../../components/money";
import { SetGrid, type SetGridCard } from "../../../components/set-grid";
import { CompletionRing } from "../../../components/ui/completion-ring";
import { cardHref, sortByFinish } from "../../../lib/cards";
import { loadMoneyDisplay } from "../../../lib/money-config";

export default async function SetCardGridPage({
  params,
}: {
  params: { game: string; set: string };
}) {
  await loadMoneyDisplay();
  const game = await prisma.game.findUnique({ where: { slug: params.game } });
  if (!game) notFound();

  const set = await prisma.set.findUnique({
    where: { gameId_code: { gameId: game.id, code: decodeURIComponent(params.set) } },
    include: {
      printings: {
        orderBy: [{ sortNumber: "asc" }, { collectorNumber: "asc" }],
        include: {
          card: true,
          rarity: true,
          variants: { include: { collection: { select: { quantity: true } } } },
        },
      },
    },
  });
  if (!set) notFound();

  const values = await latestValuations(set.printings.flatMap((p) => p.variants.map((v) => v.id)));

  let masterValue = 0;
  let ownedValue = 0;
  const cards: SetGridCard[] = set.printings.map((printing) => {
    const variants = sortByFinish(printing.variants);
    const prices = variants
      .map((v) => values.get(v.id)?.valueEur)
      .filter((v): v is number => v !== undefined);
    masterValue += Math.max(0, ...prices);
    let owned = 0;
    for (const v of variants) {
      const qty = v.collection.reduce((s, c) => s + c.quantity, 0);
      owned += qty;
      ownedValue += qty * (values.get(v.id)?.valueEur ?? 0);
    }
    return {
      id: printing.id,
      href: cardHref(game.slug, set.code, printing.collectorNumber),
      name: printing.card.name,
      number: printing.collectorNumber,
      sortNumber: printing.sortNumber,
      rarity: printing.rarity?.name ?? null,
      imageKey: printing.imageKey,
      finishes: variants.map((v) => v.finish),
      price: prices.length > 0 ? Math.min(...prices) : null,
      multiPrice: prices.length > 1,
      owned,
      subset: printing.subset,
    };
  });
  const ownedDistinct = cards.filter((c) => c.owned > 0).length;

  return (
    <main className="page">
      <header className="mb-6 flex flex-wrap items-center gap-6">
        <div className="flex h-20 w-44 items-center justify-center">
          {set.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={set.logoUrl}
              alt=""
              className="max-h-20 max-w-full object-contain drop-shadow-md"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            <Link href={`/${game.slug}`} className="hover:underline">
              {game.name}
            </Link>
            {set.series ? ` · ${set.series}` : ""}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{set.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {set.releaseDate ? `Released ${set.releaseDate.toLocaleDateString()} · ` : ""}
            {set.printings.length} cards
            {masterValue > 0 ? ` · master set ≈ ${formatEur(masterValue)}` : ""}
          </p>
        </div>
        <div className="panel flex items-center gap-4 px-5 py-3">
          <CompletionRing owned={ownedDistinct} total={set.printings.length} size={52} />
          <div>
            <p className="text-sm font-semibold">
              {ownedDistinct} / {set.printings.length} owned
            </p>
            <p className="text-xs text-neutral-500">
              {ownedValue > 0 ? `${formatEur(ownedValue)} in your collection` : "None owned yet"}
            </p>
          </div>
        </div>
      </header>
      <SetGrid cards={cards} subsets={subsetsForSet(set.code)} />
    </main>
  );
}
