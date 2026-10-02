import { Coins, Layers, TrendingUp } from "lucide-react";
import { cookies } from "next/headers";
import { collectionItemValue, getSettings, latestValuations, prisma } from "@tcg-vault/db";
import { CollectionView, type CollectionRow } from "../../components/collection-view";
import { COLLECTION_VIEW_COOKIE } from "../../lib/ui-cookies";
import { formatEur } from "../../components/money";
import { ButtonLink } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";
import { StatTile } from "../../components/ui/stat-tile";
import { cardHref } from "../../lib/cards";
import { loadMoneyDisplay } from "../../lib/money-config";

// No DATABASE_URL at build time (only set at runtime by the desktop sidecar) —
// prerendering this page would fail, so it must render on request instead.
export const dynamic = "force-dynamic";

export default async function CollectionPage() {
  await loadMoneyDisplay();
  const settings = await getSettings();
  const items = await prisma.collectionItem.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      variant: {
        include: {
          printing: { include: { card: true, rarity: true, set: { include: { game: true } } } },
        },
      },
    },
  });
  const values = await latestValuations(items.map((i) => i.variantId));
  const rows: CollectionRow[] = items.map((item) => {
    const p = item.variant.printing;
    return {
      id: item.id,
      href: cardHref(p.set.game.slug, p.set.code, p.collectorNumber),
      name: p.card.name,
      number: p.collectorNumber,
      setName: p.set.name,
      imageKey: p.imageKey,
      finish: item.variant.finish,
      rarity: p.rarity?.name ?? null,
      quantity: item.quantity,
      condition: item.condition,
      graded: item.gradingCompany ? `${item.gradingCompany} ${item.grade ?? ""}`.trim() : null,
      value: collectionItemValue(values.get(item.variantId)?.valueEur, item),
      paidPerCard: item.purchasePrice,
      addedAt: item.createdAt.getTime(),
    };
  });
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const cards = rows.reduce((s, r) => s + r.quantity, 0);
  const paidRows = rows.filter((r) => r.paidPerCard !== null);
  const cost = paidRows.reduce((s, r) => s + r.paidPerCard! * r.quantity, 0);
  const pnl = paidRows.reduce((s, r) => s + (r.value ?? 0), 0) - cost;
  const view = (await cookies()).get(COLLECTION_VIEW_COOKIE)?.value === "list" ? "list" : "grid";

  return (
    <main className="page">
      <PageHeader eyebrow="Your cards" title="Collection" />
      {rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nothing here yet"
          action={<ButtonLink href="/browse">Browse the catalog</ButtonLink>}
        >
          Open any card and press “Add to collection” — with its finish, condition and what you
          paid.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatTile
              label="Collection value"
              value={total}
              format="eur"
              icon={Coins}
              highlight
              sub="Near-mint value adjusted for condition"
            />
            <StatTile
              label="Cards"
              value={cards}
              format="int"
              icon={Layers}
              sub={`${rows.length} entries`}
            />
            <StatTile
              label="Profit / loss"
              icon={TrendingUp}
              display={
                paidRows.length > 0 ? `${pnl >= 0 ? "+" : "−"}${formatEur(Math.abs(pnl))}` : "—"
              }
              sub={
                paidRows.length > 0 ? `on ${formatEur(cost)} paid` : "Add a price paid to track it"
              }
            />
          </div>
          <CollectionView
            rows={rows}
            initialView={view}
            bulkThreshold={settings.bulkThresholdCents}
          />
        </>
      )}
    </main>
  );
}
