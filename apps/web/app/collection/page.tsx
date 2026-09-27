import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@tcg-vault/db";

// Middleware already redirects signed-out requests before they reach this
// component, but Supabase's own guidance is to never rely on middleware
// alone for the actual auth check - a Server Component can still render
// without going through it (static optimization, direct RSC fetch, etc).
export default async function CollectionPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/collection");
  }

  const items = await prisma.collectionItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      variant: {
        include: { printing: { include: { card: true } } },
      },
    },
  });

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Your collection</h1>
      {items.length === 0 ? (
        <p className="mt-4 text-neutral-500">
          No cards yet - the card database and add-to-collection flow ship in a later sprint.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded border border-neutral-800 p-3">
              {item.variant.printing.card.name} x{item.quantity}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
