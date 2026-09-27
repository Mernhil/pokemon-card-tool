import Link from "next/link";
import { prisma } from "@tcg-vault/db";
import { formatMoney } from "@tcg-vault/shared";

// No DATABASE_URL at build time (only set at runtime by the desktop sidecar) —
// prerendering this page would fail, so it must render on request instead.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const items = await prisma.collectionItem.findMany({
    include: {
      variant: {
        include: {
          printing: { include: { rarity: true, set: { include: { game: true } } } },
        },
      },
    },
  });

  const totalCards = items.reduce((sum, item) => sum + item.quantity, 0);
  const uniquePrintings = new Set(items.map((item) => item.variant.printing.id)).size;

  const costBasisByCurrency = new Map<string, number>();
  for (const item of items) {
    if (item.purchasePrice == null) continue;
    const currency = item.purchaseCurrency ?? "USD";
    costBasisByCurrency.set(
      currency,
      (costBasisByCurrency.get(currency) ?? 0) + item.purchasePrice * item.quantity,
    );
  }

  const rarityCounts = new Map<string, number>();
  for (const item of items) {
    const label = item.variant.printing.rarity?.name ?? "Unknown rarity";
    rarityCounts.set(label, (rarityCounts.get(label) ?? 0) + item.quantity);
  }
  const rarityBreakdown = [...rarityCounts.entries()].sort((a, b) => b[1] - a[1]);

  const setIds = new Set(items.map((item) => item.variant.printing.set.id));
  const sets = await prisma.set.findMany({
    where: { id: { in: [...setIds] } },
    include: { game: true, _count: { select: { printings: true } } },
  });
  const ownedPrintingIdsBySet = new Map<number, Set<string>>();
  for (const item of items) {
    const setId = item.variant.printing.set.id;
    if (!ownedPrintingIdsBySet.has(setId)) ownedPrintingIdsBySet.set(setId, new Set());
    ownedPrintingIdsBySet.get(setId)!.add(item.variant.printing.id);
  }
  const setProgress = sets
    .map((set) => ({
      set,
      owned: ownedPrintingIdsBySet.get(set.id)?.size ?? 0,
      total: set._count.printings,
    }))
    .sort((a, b) => b.owned / b.total - a.owned / a.total);

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {items.length === 0 ? (
        <p className="mt-6 text-neutral-500">
          Nothing tracked yet. <Link href="/browse" className="underline">Browse the catalog</Link> and
          add a card to your collection to see stats here.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Cards owned</p>
              <p className="mt-1 text-2xl font-semibold">{totalCards}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Unique printings</p>
              <p className="mt-1 text-2xl font-semibold">{uniquePrintings}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Cost basis</p>
              {costBasisByCurrency.size === 0 ? (
                <p className="mt-1 text-2xl font-semibold text-neutral-400">—</p>
              ) : (
                <p className="mt-1 text-2xl font-semibold">
                  {[...costBasisByCurrency.entries()]
                    .map(([currency, amount]) => formatMoney({ amount, currency }))
                    .join(" + ")}
                </p>
              )}
              <p className="mt-1 text-xs text-neutral-400">
                Sum of purchase prices you&rsquo;ve entered. Market valuation isn&rsquo;t wired up
                yet — no price source syncs into this build.
              </p>
            </div>
          </div>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Rarity breakdown</h2>
            <ul className="mt-4 divide-y">
              {rarityBreakdown.map(([label, count]) => (
                <li key={label} className="flex items-center justify-between py-2 text-sm">
                  <span>{label}</span>
                  <span className="text-neutral-500">
                    {count} card{count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">Set completion</h2>
            <ul className="mt-4 space-y-3">
              {setProgress.map(({ set, owned, total }) => {
                const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
                return (
                  <li key={set.id}>
                    <Link
                      href={`/${set.game.slug}/${encodeURIComponent(set.code)}`}
                      className="flex items-center justify-between text-sm hover:underline"
                    >
                      <span>{set.name}</span>
                      <span className="text-neutral-500">
                        {owned} / {total} ({pct}%)
                      </span>
                    </Link>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-neutral-100">
                      <div
                        className="h-1.5 rounded-full bg-neutral-900"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
