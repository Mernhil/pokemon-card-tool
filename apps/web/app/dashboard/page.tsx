import { ChartLine, Coins, Layers, Library, TrendingUp } from "lucide-react";
import Link from "next/link";
import { collectionItemValue, latestValuations, prisma } from "@tcg-vault/db";
import { CardTile } from "../../components/card-tile";
import { formatEur } from "../../components/money";
import { ButtonLink } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { LineChart } from "../../components/ui/line-chart";
import { PageHeader } from "../../components/ui/page-header";
import { StatTile } from "../../components/ui/stat-tile";
import { cardHref } from "../../lib/cards";

// Reads the local DB on every request (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

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
    <section className="panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No data yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.slice(0, 8).map((r) => (
            <li
              key={r.label}
              title={`${r.label}: ${formatEur(r.value)} · ${r.count} card${r.count === 1 ? "" : "s"}`}
              className="group"
            >
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate text-neutral-700">{r.label}</span>
                <span className="tabular-nums text-neutral-900">{formatEur(r.value)}</span>
              </div>
              <div className="mt-1.5 h-2 w-full">
                <div
                  className="h-2 rounded-r bg-accent transition-colors group-hover:bg-accent-strong"
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
  const [items, catalogCards, syncedSets, snapshots] = await Promise.all([
    prisma.collectionItem.findMany({
      include: {
        variant: {
          include: {
            printing: { include: { card: true, rarity: true, set: { include: { game: true } } } },
          },
        },
      },
    }),
    prisma.printing.count(),
    prisma.set.count(),
    prisma.portfolioSnapshot.findMany({ orderBy: { day: "asc" } }),
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
  const pnl = paidRows.reduce((s, r) => s + (r.value ?? 0), 0) - costBasis;
  const previous = snapshots
    .filter((s) => s.day.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10))
    .at(-1);

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
    .slice(0, 12);

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

  if (items.length === 0) {
    return (
      <main className="page">
        <PageHeader eyebrow="Overview" title="Dashboard" />
        <EmptyState
          icon={ChartLine}
          title={catalogCards === 0 ? "Nothing to show yet" : "Your collection is empty"}
          action={
            catalogCards === 0 ? (
              <ButtonLink href="/sync">Sync some sets</ButtonLink>
            ) : (
              <ButtonLink href="/browse">Browse the catalog</ButtonLink>
            )
          }
        >
          {catalogCards === 0
            ? "Sync a few sets, add the cards you own, and their value shows up here."
            : "Add cards from any card page — their value, trends and set progress show up here."}
        </EmptyState>
      </main>
    );
  }

  const delta = previous ? totalValue - previous.totalValue : null;
  // Chart ends on the live value (today's stored snapshot may predate edits).
  const todayKey = new Date().toISOString().slice(0, 10);
  const chartPoints = [
    ...snapshots
      .filter((s) => s.day.toISOString().slice(0, 10) !== todayKey)
      .map((s) => ({ t: s.day.getTime(), v: s.totalValue })),
    { t: new Date(`${todayKey}T00:00:00Z`).getTime(), v: totalValue },
  ];

  return (
    <main className="page">
      <PageHeader eyebrow="Overview" title="Dashboard" />
      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Collection value"
          value={totalValue}
          format="eur"
          icon={Coins}
          highlight
          sub={
            delta !== null
              ? `${delta >= 0 ? "▲" : "▼"} ${formatEur(Math.abs(delta))} since ${previous!.day.toLocaleDateString()}`
              : unpriced > 0
                ? `${unpriced} entr${unpriced === 1 ? "y" : "ies"} without a price yet`
                : "Near-mint value adjusted for condition"
          }
        />
        <StatTile
          label="Profit / loss"
          icon={TrendingUp}
          display={paidRows.length > 0 ? `${pnl >= 0 ? "+" : "−"}${formatEur(Math.abs(pnl))}` : "—"}
          sub={
            paidRows.length > 0
              ? `on ${formatEur(costBasis)} paid`
              : "Enter a price paid when adding cards"
          }
        />
        <StatTile
          label="Cards owned"
          value={cardCount}
          format="int"
          icon={Layers}
          sub={`${items.length} entries`}
        />
        <StatTile
          label="Catalog"
          value={catalogCards}
          format="int"
          icon={Library}
          sub={`cards in ${syncedSets} synced set${syncedSets === 1 ? "" : "s"}`}
        />
      </div>

      <section className="panel mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold">Collection value over time</h2>
        {chartPoints.length >= 2 ? (
          <LineChart
            label="Collection value over time"
            series={[
              {
                id: "value",
                label: "Collection value",
                color: "rgb(var(--accent))",
                points: snapshots.map((s) => ({ t: s.day.getTime(), v: s.totalValue })),
              },
            ]}
          />
        ) : (
          <p className="text-sm text-neutral-500">
            One point per day the app refreshes prices — the chart appears from the second day
            {snapshots.length === 1
              ? ` (${formatEur(snapshots[0]!.totalValue)} on ${snapshots[0]!.day.toLocaleDateString()})`
              : ""}
            .
          </p>
        )}
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <BarList title="Value by set" rows={bySet} />
        <BarList title="Value by rarity" rows={byRarity} />
      </div>

      {setProgress.length > 0 ? (
        <section className="panel mt-6 p-5">
          <h2 className="text-sm font-semibold">Set completion</h2>
          <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {setProgress.map(({ set, owned, total }) => {
              const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
              return (
                <li key={set.id} title={`${set.name}: ${owned} of ${total} cards (${pct}%)`}>
                  <Link
                    href={`/${set.game.slug}/${encodeURIComponent(set.code)}`}
                    className="flex justify-between gap-2 text-xs hover:text-accent"
                  >
                    <span className="truncate text-neutral-700">{set.name}</span>
                    <span className="tabular-nums text-neutral-900">
                      {owned} / {total} ({pct}%)
                    </span>
                  </Link>
                  <div className="mt-1.5 h-2 w-full rounded-r bg-neutral-100">
                    <div
                      className="h-2 rounded-r bg-accent"
                      style={{ width: `${Math.max(1, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold">Most valuable cards</h2>
        <ul className="stagger grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {top.map(({ item, value }) => {
            const p = item.variant.printing;
            return (
              <li key={item.id}>
                <CardTile
                  href={cardHref(p.set.game.slug, p.set.code, p.collectorNumber)}
                  imageKey={p.imageKey}
                  name={p.card.name}
                  number={p.collectorNumber}
                  subtitle={`${p.set.name} · ${p.collectorNumber}`}
                  finishes={[item.variant.finish]}
                  price={value}
                  owned={item.quantity}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
