import Link from "next/link";
import { notFound } from "next/navigation";
import {
  enqueueLanguagePrices,
  enqueueStalePrices,
  findLanguageSiblings,
  getCardImageResult,
  latestValuations,
  listAlerts,
  loadGradedPrices,
  prisma,
  recordCardView,
  runnableProviders,
} from "@tcg-vault/db";
import { collectorNumberCandidates, isPriceLanguage, mediaUrl } from "@tcg-vault/shared";
import { AddToCollection } from "../../../../components/add-to-collection";
import { BackToSearch } from "../../../../components/last-search";
import { WishlistButton } from "../../../../components/wishlist-button";
import { CardViewer } from "../../../../components/card-viewer";
import { FinishBadge, PriceChip, finishLabel } from "../../../../components/money";
import { PriceHistory } from "../../../../components/prices/price-history";
import { CustomImageControl } from "../../../../components/custom-image-control";
import { GradedPrices } from "../../../../components/prices/graded-prices";
import { PriceAlerts } from "../../../../components/price-alerts";
import { PriceRefresh } from "../../../../components/prices/price-refresh";
import { PriceLanguageSelect } from "../../../../components/prices/price-language-select";
import { PricesSection } from "../../../../components/prices/prices-section";
import { priceProviders, requestPriceRefresh } from "../../../../lib/background";
import { PROVIDER_COLORS, loadCardPrices } from "../../../../lib/card-prices";
import { cardHref, sortByFinish } from "../../../../lib/cards";
import { loadMoneyDisplay } from "../../../../lib/money-config";

export const dynamic = "force-dynamic";

/** "001" / "TG01" from the URL -> the printing whose collector number starts with it. */
async function findPrinting(setId: number, slug: string) {
  const include = {
    card: true,
    rarity: true,
    artist: true,
    wishlist: { select: { id: true } },
    variants: {
      include: {
        language: true,
        collection: { select: { quantity: true } },
      },
    },
  };
  // The exact number first ("002-30" -> "002/30"): a set can hold "002/128" and
  // "002/30" at once, so the bare-number match below is only for old links.
  const exact = await prisma.printing.findFirst({
    where: { setId, collectorNumber: { in: collectorNumberCandidates(slug) } },
    include,
  });
  if (exact) return exact;
  const bySlug = await prisma.printing.findFirst({
    where: {
      setId,
      OR: [{ collectorNumber: slug }, { collectorNumber: { startsWith: `${slug}/` } }],
    },
    include,
  });
  if (bySlug || !/^\d+$/.test(slug)) return bySlug;
  // Older links used the bare numeric part ("1" for "001/064").
  return prisma.printing.findFirst({
    where: { setId, sortNumber: parseInt(slug, 10) },
    include,
  });
}

/**
 * One card: 3D viewer, prices from every provider for the selected finish,
 * price history, add to collection. Reads prices from the DB only; if
 * they're stale, a background refresh is queued and the page says
 * "Updating…" until it lands.
 */
export default async function CardPage({
  params,
  searchParams,
}: {
  params: { game: string; set: string; number: string };
  searchParams: { finish?: string; lang?: string };
}) {
  await loadMoneyDisplay();
  const game = await prisma.game.findUnique({ where: { slug: params.game } });
  if (!game) notFound();

  const set = await prisma.set.findUnique({
    where: { gameId_code: { gameId: game.id, code: decodeURIComponent(params.set) } },
  });
  if (!set) notFound();

  const printing = await findPrinting(set.id, decodeURIComponent(params.number));
  if (!printing) notFound();

  // Some sets (reprint collections like the 30th Anniversary Classic
  // Collection) have no scan of their own from the source yet. Since a
  // reprint shares its Card row with the printing(s) it reprints (see
  // Card.canonicalKey), fall back to showing the art from any sibling
  // printing that does have a scan, rather than a blank placeholder.
  // (The printing's own image counts only if it can actually be loaded — every
  // Pokémon printing has a lazy image key, but some sources have no scan.)
  const hasOwnImage = printing.imageKey
    ? await getCardImageResult(printing.id)
        .then((r) => r.image !== null && r.status !== "sibling")
        .catch(() => false)
    : false;
  const fallbackPrinting = hasOwnImage
    ? null
    : await prisma.printing.findFirst({
        where: { cardId: printing.cardId, id: { not: printing.id }, imageKey: { not: null } },
        select: { imageKey: true },
      });
  const imageKey = hasOwnImage ? printing.imageKey : (fallbackPrinting?.imageKey ?? null);
  const imageIsFallback = !hasOwnImage && !!fallbackPrinting;

  const variants = sortByFinish(printing.variants);
  const selected = variants.find((v) => v.finish === searchParams.finish) ?? variants[0];
  const variantIds = variants.map((v) => v.id);

  // Remember the view (recently viewed cards get refreshed) and queue a
  // background refresh for stale prices. Neither ever blocks on a provider.
  const { settings, providers } = await priceProviders();
  const active = runnableProviders(game.slug, providers, settings.providers);
  await recordCardView(printing.id).catch(() => {});
  // Digital-only (Pocket) cards have no market: nothing to price.
  const priceable = set.category !== "pocket";
  const queued = await enqueueStalePrices(
    variantIds,
    priceable ? active : [],
    game.slug,
    settings.staleAfterHours * 3_600_000,
  ).catch(() => false);
  if (queued) requestPriceRefresh(active);
  // The price language the panels show: this card's own language when it isn't English
  // (a Japanese card shows Japanese prices), else the setting, unless the page asked for another.
  const cardLanguage = selected?.languageCode ?? "en";
  const defaultLanguage =
    cardLanguage !== "en" && isPriceLanguage(cardLanguage) ? cardLanguage : settings.priceLanguage;
  const language = isPriceLanguage(searchParams.lang) ? searchParams.lang : defaultLanguage;
  const langQueued =
    priceable && language !== defaultLanguage
      ? await enqueueLanguagePrices(variantIds, game.slug, language, active).catch(() => false)
      : false;
  if (langQueued) requestPriceRefresh(["ebay"]);
  const langParam = language !== defaultLanguage ? `&lang=${language}` : "";

  const siblings = await findLanguageSiblings(printing.id).catch(() => []);
  const [values, neighbours, prices, alertRows] = await Promise.all([
    latestValuations(variantIds),
    prisma.printing.findMany({
      where: { setId: set.id },
      orderBy: [{ sortNumber: "asc" }, { collectorNumber: "asc" }],
      select: { id: true, collectorNumber: true },
    }),
    selected
      ? loadCardPrices(
          selected.id,
          variantIds,
          {
            name: printing.card.name,
            number: printing.collectorNumber,
            game: game.slug,
          },
          language,
        )
      : null,
    listAlerts(variantIds),
  ]);
  const gradedRows = selected ? await loadGradedPrices(selected.id, language) : [];
  const gradedBlocked = !settings.providers.ebay.enabled
    ? "eBay is turned off in Settings."
    : !providers.ebay.isConfigured()
      ? "Add your eBay keys in Settings to see graded prices."
      : priceable
        ? null
        : "Digital cards have no graded market.";
  const owned = variants.map((v) => ({
    finish: v.finish,
    qty: v.collection.reduce((s, c) => s + c.quantity, 0),
  }));
  const ownedTotal = owned.reduce((s, o) => s + o.qty, 0);
  const idx = neighbours.findIndex((n) => n.id === printing.id);
  const prev = idx > 0 ? neighbours[idx - 1] : undefined;
  const next = idx >= 0 && idx < neighbours.length - 1 ? neighbours[idx + 1] : undefined;

  return (
    <main className="page">
      <div className="mb-4 flex items-center justify-between text-xs">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <BackToSearch />
          <Link
            href={`/${game.slug}/${encodeURIComponent(set.code)}`}
            className="flex items-center gap-2 font-semibold uppercase tracking-[0.14em] text-accent hover:underline"
          >
            {set.symbolUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={set.symbolUrl} alt="" className="h-4 w-4 object-contain" />
            ) : null}
            {set.name}
          </Link>
        </div>
        <span className="flex gap-3 text-neutral-500">
          {prev ? (
            <Link
              href={cardHref(game.slug, set.code, prev.collectorNumber)}
              className="hover:text-neutral-900"
            >
              ← {prev.collectorNumber}
            </Link>
          ) : null}
          {next ? (
            <Link
              href={cardHref(game.slug, set.code, next.collectorNumber)}
              className="hover:text-neutral-900"
            >
              {next.collectorNumber} →
            </Link>
          ) : null}
        </span>
      </div>

      <div className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <CardViewer
            imageSrc={imageKey ? mediaUrl(imageKey) : null}
            imageIsFallback={imageIsFallback}
            name={printing.card.name}
            number={printing.collectorNumber}
            rarityName={printing.rarity?.name ?? null}
            variants={variants.map((v) => ({ id: v.id, finish: v.finish }))}
          />
          <div className="mt-3">
            <CustomImageControl printingId={printing.id} hasCustom={!!printing.customImageKey} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <header>
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              {printing.card.name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-500">
              <span>{printing.collectorNumber}</span>
              {printing.rarity ? <span>· {printing.rarity.name}</span> : null}
              {printing.artist ? <span>· Illustrated by {printing.artist.name}</span> : null}
            </p>
            {ownedTotal > 0 ? (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-neutral-800">
                You own {ownedTotal}
                {owned.filter((o) => o.qty > 0).length > 1 || variants.length > 1
                  ? ` (${owned
                      .filter((o) => o.qty > 0)
                      .map((o) => `${o.qty} ${finishLabel(o.finish)}`)
                      .join(", ")})`
                  : ""}
                <Link href="/collection" className="text-accent hover:underline">
                  View
                </Link>
              </p>
            ) : null}
          </header>

          <div className="flex flex-col gap-3">
            <AddToCollection
              cardName={printing.card.name}
              variants={variants.map((v) => ({
                id: v.id,
                finish: v.finish,
                value: values.get(v.id)?.valueEur ?? null,
              }))}
            />
            <div>
              <WishlistButton
                printingId={printing.id}
                initial={!!printing.wishlist}
                cardName={printing.card.name}
              />
            </div>
          </div>

          {selected ? (
            <PriceAlerts
              variantId={selected.id}
              currentValueEur={values.get(selected.id)?.valueEur ?? null}
              alerts={alertRows
                .filter((a) => a.variantId === selected.id)
                .map((a) => ({
                  id: a.id,
                  direction: a.direction,
                  thresholdEur: a.thresholdEur,
                  triggered: a.triggeredAt !== null,
                  triggeredValueEur: a.triggeredValueEur,
                }))}
            />
          ) : null}

          {selected && prices ? (
            <>
              <PricesSection
                prices={prices}
                variantId={selected.id}
                game={game.slug}
                header={
                  <div className="flex flex-wrap items-center gap-3">
                    {variants.length > 1 ? (
                      <nav aria-label="Finish" className="flex rounded-lg border p-0.5 text-xs">
                        {variants.map((v) => (
                          <Link
                            key={v.id}
                            href={`?finish=${v.finish}${langParam}`}
                            scroll={false}
                            aria-current={v.id === selected.id ? "page" : undefined}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${v.id === selected.id ? "bg-accent-soft font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-900"}`}
                          >
                            {finishLabel(v.finish)}
                            <PriceChip value={values.get(v.id)?.valueEur} />
                          </Link>
                        ))}
                      </nav>
                    ) : (
                      <span className="flex items-center gap-2 text-xs text-neutral-500">
                        <FinishBadge finish={selected.finish} /> value{" "}
                        <PriceChip value={values.get(selected.id)?.valueEur} />
                      </span>
                    )}
                    <PriceLanguageSelect
                      language={prices.language}
                      defaultLanguage={defaultLanguage}
                      canFilter={prices.languageFilterable}
                      siblings={siblings.map((s) => ({
                        language: s.languageCode,
                        href: cardHref(game.slug, s.setCode, s.collectorNumber),
                      }))}
                    />
                    <PriceRefresh
                      variantIds={variantIds}
                      game={game.slug}
                      initiallyUpdating={prices.updating || queued || langQueued}
                      providers={prices.panels.map((p) => ({
                        id: p.id,
                        label: p.label,
                        state: p.state,
                        message: p.message,
                        updatedAt: p.updatedAt,
                      }))}
                    />
                  </div>
                }
              />
              <PriceHistory
                points={prices.points}
                providers={prices.panels.map((p) => ({
                  id: p.id,
                  label: p.label,
                  color: PROVIDER_COLORS[p.id],
                }))}
                displayCurrency={prices.settings.displayCurrency}
                rates={prices.rates}
                cardName={printing.card.name}
              />
              <GradedPrices
                variantId={selected.id}
                language={prices.language}
                rows={gradedRows}
                displayCurrency={prices.settings.displayCurrency}
                rates={prices.rates}
                canFetch={gradedBlocked === null}
                blockedReason={gradedBlocked}
              />
            </>
          ) : null}

          {printing.card.rulesText ? (
            <section className="panel p-5">
              <h2 className="mb-2 text-sm font-semibold">Card text</h2>
              <p className="whitespace-pre-line text-sm text-neutral-700">
                {printing.card.rulesText}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
