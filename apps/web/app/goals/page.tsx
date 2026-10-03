import Link from "next/link";
import { goalSearchParams, listGoals } from "@tcg-vault/db";
import { CompletionRing } from "../../components/ui/completion-ring";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";
import { ButtonLink } from "../../components/ui/button";
import { Target } from "lucide-react";
import { DeleteGoalButton } from "./delete-goal";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const goals = await listGoals();
  return (
    <main className="page max-w-3xl">
      <PageHeader
        eyebrow="Goals"
        title="Your goals"
        subtitle="Any search can be a goal: run it on Search, name it, and its progress shows here."
      />
      <p className="mb-5 text-sm">
        <Link href="/pokedex" className="text-accent hover:underline">
          Living Pokédex
        </Link>{" "}
        <span className="text-neutral-500">is always on: one card of every Pokémon.</span>
      </p>
      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          action={<ButtonLink href="/search">Open Search</ButtonLink>}
        >
          Search for “Charizard”, pick a rarity or a set, then press “Save goal” to track how many
          of them you own.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((g) => {
            const pct = g.total > 0 ? Math.round((100 * g.owned) / g.total) : 0;
            return (
              <li key={g.id} className="panel flex items-center gap-4 p-4">
                <CompletionRing owned={g.owned} total={g.total} size={44} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/search?${goalSearchParams(g.filter)}`}
                    className="font-medium hover:text-accent"
                  >
                    {g.name}
                  </Link>
                  <p className="text-xs text-neutral-500">
                    {g.owned} of {g.total} cards · {pct}%
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <DeleteGoalButton id={g.id} name={g.name} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
