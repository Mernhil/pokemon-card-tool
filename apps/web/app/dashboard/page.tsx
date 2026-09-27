import Link from "next/link";
import { collectionItemValue, latestValuations, prisma } from "@tcg-vault/db";
import { mediaUrl } from "@tcg-vault/shared";
import { FinishBadge, formatEur } from "../../components/money";
import { cardHref } from "../../lib/cards";

// Reads the local DB on every request (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}

/** Ranked single-series bars: one hue, label + value in text ink, native tooltip on hover. */
function BarList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number; count: number }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No data yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.label}
              title={`${r.label}: ${formatEur(r.value)} · ${r.count} card${r.count === 1 ? "" : "s"}`}
              className="group"
            >
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate text-neutral-700">{r.label}</span>
                <span className="tabular-nums text-neutral-900">{formatEur(r.value)}</span>
              </div>
              <div className="mt-1 h-2 w-full">
                <div
                  className="h-2 rounded-r bg-emerald-600 group-hover:bg-emerald-700"
                  style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function groupBy<T>(
  items: T[],
  key: (t: T) => string,
  value: (t: T) => number,
  count: (t: T) => number,
) {
  const map = new Map<string, { label: string; value: number; count: number }>();
  for (const item of items) {
    const k = key(item);
    const row = map.get(k) ?? { label: k, value: 0, count: 0 };
    row.value += value(item);
    row.count += count(item);
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export default async function DashboardPage() {
  const [items, catalogCards, syncedSets] = await Promise.all([
    prisma.collectionItem.findMany({
      include: {
        variant: {
          include: {
            printing: {
              include: { card: true, rarity: true, set: { include: { game: true } } },
            },
          },
        },
      },
    }),
    prisma.printing.count(),
    prisma.set.count(),
  ]);

  const values = await latestValuations(items.map((i) => i.variantId));
  const rows = items.map((item) => ({
    item,
    value: collectionItemValue(values.get(item.variantId)?.valueEur, item),
  }));

  const totalValue = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const cardCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const unpriced = rows.filter((r) => r.value === null).length;
  const paidRows = rows.filter((r) => r.item.purchasePrice !== null);
  const costBasis = paidRows.reduce((s, r) => s + r.item.purchasePrice! * r.item.quantity, 0);
  const paidValue = paidRows.reduce((s, r) => s + (r.value ?? 0), 0);
  const pnl = paidValue - costBasis;

  const bySet = groupBy(
    rows,
    (r) => r.item.variant.printing.set.name,
    (r) => r.value ?? 0,
    (r) => r.item.quantity,
  );
  const byRarity = groupBy(
    rows,
    (r) => r.item.variant.printing.rarity?.name ?? "Unknown",
    (r) => r.value ?? 0,
    (r) => r.item.quantity,
  );
  const top = [...rows]
    .filter((r) => r.value !== null)
    .sort((a, b) => b.value! - a.value!)
    .slice(0, 10);

  // Set completion: distinct printings owned vs. printings in the set.
  const ownedBySet = new Map<number, Set<string>>();
  for (const { variant } of items) {
    const owned = ownedBySet.get(variant.printing.setId) ?? new Set<string>();
    owned.add(variant.printingId);
    ownedBySet.set(variant.printing.setId, owned);
  }
  const ownedSets = await prisma.set.findMany({
    where: { id: { in: [...ownedBySet.keys()] } },
    include: { game: true, _count: { select: { printings: true } } },
  });
  const setProgress = ownedSets
    .map((set) => ({ set, owned: ownedBySet.get(set.id)!.size, total: set._count.printings }))
    .sort((a, b) => b.owned / Math.max(1, b.total) - a.owned / Math.max(1, a.total));

  const snapshots = await prisma.portfolioSnapshot.findMany({ orderBy: { day: "desc" }, take: 2 });
  const previous = snapshots.find(
    (s) => s.day.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10),
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {items.length === 0 ? (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {catalogCards === 0 ? (
            <>
              Nothing to show yet.{" "}
              <Link href="/sync" className="font-medium underline">
                Sync some sets
              </Link>
              , then add cards to your collection from any card page.
            </>
          ) : (
            <>
              Your collection is empty.{" "}
              <Link href="/browse" className="font-medium underline">
                Browse the catalog
              </Link>{" "}
              and add cards from their card pages — their value shows up here.
            </>
          )}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="Collection value"
          value={formatEur(totalValue)}
          sub={
            previous
              ? `${totalValue - previous.totalValue >= 0 ? "▲" : "▼"} ${formatEur(Math.abs(totalValue - previous.totalValue))} since ${previous.day.toLocaleDateString()}`
              : unpriced > 0
                ? `${unpriced} entr${unpriced === 1 ? "y" : "ies"} without a price yet`
                : "Near-mint value adjusted for condition"
          }
        />
        <Tile
          label="Profit / loss"
          value={paidRows.length > 0 ? `${pnl >= 0 ? "+" : "−"}${formatEur(Math.abs(pnl))}` : "—"}
          sub={
            paidRows.length > 0
              ? `on ${formatEur(costBasis)} paid (${paidRows.length} entr${paidRows.length === 1 ? "y" : "ies"} with a price paid)`
              : "Enter a price paid when adding cards"
          }
        />
        <Tile label="Cards owned" value={String(cardCount)} sub={`${items.length} entries`} />
        <Tile
          label="Catalog"
          value={String(catalogCards)}
          sub={`cards in ${syncedSets} synced set${syncedSets === 1 ? "" : "s"}`}
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <BarList title="Value by set" rows={bySet} />
        <BarList title="Value by rarity" rows={byRarity} />
      </div>

      {setProgress.length > 0 ? (
        <section className="mt-6 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Set completion</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {setProgress.map(({ set, owned, total }) => {
              const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
              return (
                <li key={set.id} title={`${set.name}: ${owned} of ${total} cards (${pct}%)`}>
                  <Link
                    href={`/${set.game.slug}/${encodeURIComponent(set.code)}`}
                    className="flex justify-between gap-2 text-xs hover:underline"
                  >
                    <span className="truncate text-neutral-700">{set.name}</span>
                    <span className="tabular-nums text-neutral-900">
                      {owned} / {total} ({pct}%)
                    </span>
                  </Link>
                  <div className="mt-1 h-2 w-full rounded-r bg-neutral-100">
                    <div
                      className="h-2 rounded-r bg-emerald-600"
                      style={{ width: `${Math.max(1, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Most valuable cards</h2>
        {top.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No priced cards in your collection yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {top.map(({ item, value }) => {
                const { printing } = item.variant;
                return (
                  <tr key={item.id} className="border-b last:border-b-0">
                    <td className="w-10 py-1.5">
                      {printing.imageKey ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaUrl(printing.imageKey)} alt="" className="h-10 rounded" />
                      ) : null}
                    </td>
                    <td className="py-1.5">
                      <Link
                        href={cardHref(
                          printing.set.game.slug,
                          printing.set.code,
                          printing.collectorNumber,
                        )}
                        className="font-medium hover:underline"
                      >
                        {printing.card.name}
                      </Link>
                      <span className="ml-2 text-xs text-neutral-500">
                        {printing.set.name} · {printing.collectorNumber}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <FinishBadge finish={item.variant.finish} />
                    </td>
                    <td className="py-1.5 text-right text-xs text-neutral-500">×{item.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatEur(value!)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
