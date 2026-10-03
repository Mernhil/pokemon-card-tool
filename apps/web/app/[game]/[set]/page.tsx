import { variantKind } from "@tcg-vault/shared/src/enums";
import Link from "next/link";
import { notFound } from "next/navigation";
import { latestValuations, prisma } from "@tcg-vault/db";
import { subsetsForSet } from "@tcg-vault/shared";
import { formatEur } from "../../../components/money";
import { SetGrid, type SetGridCard, type SetGridVariant } from "../../../components/set-grid";
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
          variants: {
            include: {
              collection: { select: { quantity: true, gradingCompany: true, certNumber: true } },
            },
          },
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
    const gridVariants: SetGridVariant[] = [];
    for (const v of variants) {
      const qty = v.collection.reduce((s, c) => s + c.quantity, 0);
      const plain = v.collection
        .filter((c) => c.gradingCompany === null && c.certNumber === null)
        .reduce((s, c) => s + c.quantity, 0);
      gridVariants.push({ id: v.id, finish: variantKind(v), owned: qty, ownedPlain: plain });
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
      finishes: variants.map((v) => variantKind(v)),
      price: prices.length > 0 ? Math.min(...prices) : null,
      multiPrice: prices.length > 1,
      owned,
      subset: printing.subset,
      variants: gridVariants,
    };
  });
  const ownedDistinct = cards.filter((c) => c.owned > 0).length;
  // Master set: every finish and edition counts, not just one card per number.
  const masterTotal = cards.reduce((s, c) => s + c.variants.length, 0);
  const masterOwned = cards.reduce((s, c) => s + c.variants.filter((v) => v.owned > 0).length, 0);
  // What's still missing, priciest first, and what it would cost to fill the gaps.
  const missing = cards
    .filter((c) => c.owned === 0)
    .sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  const costToComplete = missing.reduce((sum, c) => sum + (c.price ?? 0), 0);
  const unpricedMissing = missing.filter((c) => c.price === null).length;

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
            {masterTotal > set.printings.length ? (
              <p className="text-xs text-neutral-500">
                Master set: {masterOwned} / {masterTotal} (every finish
                {cards.some((c) => c.finishes.some((f) => f.includes(":"))) ? " and edition" : ""})
              </p>
            ) : null}
          </div>
        </div>
      </header>
      {missing.length > 0 && ownedDistinct > 0 ? (
        <details className="panel mb-5 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {missing.length} missing · about {formatEur(costToComplete)} to complete
            {unpricedMissing > 0 ? ` (${unpricedMissing} unpriced)` : ""}
          </summary>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {missing.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <Link href={c.href} className="truncate hover:text-accent">
                  {c.name} <span className="text-neutral-500">{c.number}</span>
                </Link>
                <span className="tabular-nums text-neutral-500">
                  {c.price !== null ? formatEur(c.price) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <SetGrid cards={cards} subsets={subsetsForSet(set.code)} />
    </main>
  );
}
