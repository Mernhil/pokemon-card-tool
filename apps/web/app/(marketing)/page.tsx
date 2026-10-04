import { variantKind } from "@tcg-vault/shared/src/enums";
import { ArrowRight, BookOpen, Check, Layers, Library, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { collectionItemValue, computeValuations, latestValuations, listBinders, prisma } from "@tcg-vault/db";
import { BinderCover } from "../../components/binders/binder-cover";
import { CardTile } from "../../components/card-tile";
import { cardHref } from "../../lib/cards";
import { ButtonLink } from "../../components/ui/button";
import { CountUp } from "../../components/ui/count-up";
import { loadMoneyDisplay } from "../../lib/money-config";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await loadMoneyDisplay();
  const [items, catalogCards, binders] = await Promise.all([
    prisma.collectionItem.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        variant: {
          include: {
            printing: { include: { card: true, rarity: true, set: { include: { game: true } } } },
          },
        },
      },
    }),
    prisma.printing.count(),
    listBinders(),
  ]);
  // Values from the prices stored right now: a refresh minutes ago must show up here.
  await computeValuations(new Date(), undefined, {
    variantIds: [...new Set(items.map((i) => i.variantId))],
  }).catch(() => 0);
  const values = await latestValuations(items.map((i) => i.variantId));
  const withValue = items.map((item) => ({
    item,
    value: collectionItemValue(values.get(item.variantId)?.valueEur, item),
  }));
  const total = withValue.reduce((s, r) => s + (r.value ?? 0), 0);
  const cards = items.reduce((s, i) => s + i.quantity, 0);
  const recent = withValue.slice(0, 6);
  const top = [...withValue]
    .filter((r) => r.value)
    .sort((a, b) => b.value! - a.value!)
    .slice(0, 6);

  const steps = [
    {
      done: catalogCards > 0,
      label: "Sync a few sets",
      body: "Cards, images and prices from TCGdex.",
      href: "/sync",
      icon: RefreshCw,
    },
    {
      done: items.length > 0,
      label: "Add cards you own",
      body: "From any card page — with condition and price paid.",
      href: "/browse",
      icon: Layers,
    },
    {
      done: binders.length > 0,
      label: "Build a binder",
      body: "Drag your cards into pages, or start from a set.",
      href: "/binders",
      icon: BookOpen,
    },
  ];
  const onboarding = steps.some((s) => !s.done);

  return (
    <main className="page">
      {/* Hero */}
      <section className="panel holo-border relative mb-8 overflow-hidden p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl"
        />
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Your vault</p>
        <p className="mt-2 text-5xl font-semibold tracking-tight">
          <span className="text-foil">
            <CountUp value={total} format="eur" />
          </span>
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          {cards} card{cards === 1 ? "" : "s"} in your collection · {binders.length} binder
          {binders.length === 1 ? "" : "s"} · {catalogCards} cards in the catalog
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink href="/browse">
            <Library className="h-4 w-4" /> Browse cards
          </ButtonLink>
          <ButtonLink href="/binders" variant="secondary">
            <BookOpen className="h-4 w-4" /> Binders
          </ButtonLink>
          <ButtonLink href="/sync" variant="secondary">
            <RefreshCw className="h-4 w-4" /> Sync prices
          </ButtonLink>
        </div>
      </section>

      {onboarding ? (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-accent" /> Getting started
          </h2>
          <ol className="stagger grid gap-3 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className={`panel card-tile flex h-full items-start gap-3 p-4 ${s.done ? "opacity-60" : ""}`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                      s.done ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-neutral-500">{s.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <Section title="Recently added" href="/collection" link="Collection">
          <ul className="stagger grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {recent.map(({ item, value }) => {
              const p = item.variant.printing;
              return (
                <li key={item.id}>
                  <CardTile
                    href={cardHref(p.set.game.slug, p.set.code, p.collectorNumber)}
                    imageKey={p.imageKey}
                    name={p.card.name}
                    number={p.collectorNumber}
                    subtitle={`${p.set.name} · ${p.collectorNumber}`}
                    finishes={[variantKind(item.variant)]}
                    price={value}
                  />
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {binders.length > 0 ? (
        <Section title="Your binders" href="/binders" link="Shelf">
          <ul className="stagger grid grid-cols-2 gap-8 sm:grid-cols-4 lg:grid-cols-6">
            {binders.slice(0, 6).map((b) => (
              <li key={b.id}>
                <Link href={`/binders/${b.id}`} className="binder-shelf-item group block">
                  <BinderCover name={b.name} color={b.color} coverImageKey={b.coverImageKey} />
                  <p className="mt-3 truncate text-sm font-medium group-hover:text-accent">
                    {b.name}
                  </p>
                  <p className="text-xs text-neutral-500">{b.cardCount} cards</p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {top.length > 0 ? (
        <Section title="Most valuable" href="/dashboard" link="Dashboard">
          <ul className="stagger grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {top.map(({ item, value }) => {
              const p = item.variant.printing;
              return (
                <li key={item.id}>
                  <CardTile
                    href={cardHref(p.set.game.slug, p.set.code, p.collectorNumber)}
                    imageKey={p.imageKey}
                    name={p.card.name}
                    number={p.collectorNumber}
                    subtitle={p.rarity?.name ?? p.set.name}
                    finishes={[variantKind(item.variant)]}
                    price={value}
                    owned={item.quantity}
                  />
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </main>
  );
}

function Section({
  title,
  href,
  link,
  children,
}: {
  title: string;
  href: string;
  link: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <Link
          href={href}
          className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          {link} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </section>
  );
}
