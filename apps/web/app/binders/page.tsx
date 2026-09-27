import { BookOpen } from "lucide-react";
import Link from "next/link";
import { listBinders, prisma } from "@tcg-vault/db";
import { BinderCover } from "../../components/binders/binder-cover";
import { NewBinderButton } from "../../components/binders/new-binder-dialog";
import { formatEur } from "../../components/money";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function BindersPage() {
  const [binders, sets] = await Promise.all([
    listBinders(),
    prisma.set.findMany({
      orderBy: { releaseDate: "desc" },
      select: { id: true, name: true, _count: { select: { printings: true } } },
    }),
  ]);
  const setOptions = sets
    .filter((s) => s._count.printings > 0)
    .map((s) => ({ id: s.id, name: s.name, printings: s._count.printings }));
  const totalValue = binders.reduce((sum, b) => sum + b.valueEur, 0);
  const totalCards = binders.reduce((sum, b) => sum + b.cardCount, 0);

  return (
    <main className="page">
      <PageHeader
        eyebrow="Your shelf"
        title="Binders"
        subtitle={
          binders.length > 0
            ? `${binders.length} binder${binders.length === 1 ? "" : "s"} · ${totalCards} cards · ${formatEur(totalValue)}`
            : "Arrange your cards in pages, just like the real thing."
        }
        actions={<NewBinderButton sets={setOptions} />}
      />

      {binders.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Your shelf is empty"
          action={<NewBinderButton sets={setOptions} />}
        >
          Create a binder and drag cards from your collection into its pockets — or start from a set
          to get one pocket per card, with the ones you&apos;re missing greyed out.
        </EmptyState>
      ) : (
        <ul className="stagger grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {binders.map((b) => {
            const pockets = b.pageCount * b.rows * b.cols;
            const completion =
              b.wantCount > 0 ? Math.round((b.wantsFilled / b.wantCount) * 100) : null;
            return (
              <li key={b.id}>
                <Link href={`/binders/${b.id}`} className="binder-shelf-item group block">
                  <BinderCover name={b.name} color={b.color} coverImageKey={b.coverImageKey} />
                  <div className="mt-4 px-1">
                    <p className="truncate font-medium text-neutral-900 group-hover:text-accent">
                      {b.name}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {b.cardCount} / {pockets} pockets · {b.pageCount} pages · {b.rows}×{b.cols}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold tabular-nums text-neutral-900">
                        {formatEur(b.valueEur)}
                      </span>
                      {completion !== null ? (
                        <span className="text-xs tabular-nums text-neutral-500">
                          {completion}% complete
                        </span>
                      ) : null}
                    </div>
                    {completion !== null ? (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-200">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${completion}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
