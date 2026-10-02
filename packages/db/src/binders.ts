import { cardSlug } from "@tcg-vault/shared";
import { interactiveTransaction, prisma } from "./client";
import { inChunks } from "./chunk";
import { BINDER_LAYOUTS } from "./binder-options";
import { collectionItemValue, latestValuations } from "./valuations";

export * from "./binder-options";
export * from "./binder-types";
import type { AvailableCard, BinderDetail, Pocket, PocketCard } from "./binder-types";

/**
 * Binders: pages of pockets (rows x cols). A pocket (BinderSlot) can hold
 * an owned copy (collectionItemId — one card of that item's quantity) and/or
 * be *for* a card (placeholderVariantId, a "want"): wants stay when the
 * owned copy is taken out, so a set binder keeps its shape.
 *
 * Only pockets with something in them have a BinderSlot row.
 */

const MAX_PAGES = 200;

function assertLayout(rows: number, cols: number) {
  if (!BINDER_LAYOUTS.some((l) => l.rows === rows && l.cols === cols)) {
    throw new Error(`Unsupported binder layout ${rows}x${cols}`);
  }
}

function assertColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid colour ${color}`);
}

const slotInclude = {
  collectionItem: {
    include: {
      variant: {
        include: {
          printing: { include: { card: true, rarity: true, set: { include: { game: true } } } },
        },
      },
    },
  },
} as const;

const variantInclude = {
  printing: { include: { card: true, rarity: true, set: { include: { game: true } } } },
} as const;

/** How many copies of each collection item are already sitting in binder pockets. */
async function slotsUsedByItem(): Promise<Map<string, number>> {
  const used = await prisma.binderSlot.groupBy({
    by: ["collectionItemId"],
    where: { collectionItemId: { not: null } },
    _count: { _all: true },
  });
  return new Map(used.map((u) => [u.collectionItemId!, u._count._all]));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface BinderSummary {
  id: string;
  name: string;
  color: string;
  rows: number;
  cols: number;
  pageCount: number;
  cardCount: number;
  wantCount: number;
  /** Wants that are filled with an owned copy. */
  wantsFilled: number;
  valueEur: number;
  coverImageKey: string | null;
  setName: string | null;
}

export async function listBinders(): Promise<BinderSummary[]> {
  const binders = await prisma.binder.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      set: true,
      _count: { select: { pages: true } },
      pages: {
        include: {
          slots: { include: slotInclude, orderBy: { position: "asc" } },
        },
        orderBy: { pageIndex: "asc" },
      },
    },
  });

  const variantIds = binders.flatMap((b) =>
    b.pages.flatMap((p) =>
      p.slots.flatMap((s) => (s.collectionItem ? [s.collectionItem.variantId] : [])),
    ),
  );
  const values = await latestValuations(variantIds);

  return binders.map((b) => {
    const slots = b.pages.flatMap((p) => p.slots);
    const owned = slots.filter((s) => s.collectionItem);
    // Cover: the most valuable card in the binder, else the first one.
    let cover: string | null = null;
    let best = -1;
    let valueEur = 0;
    for (const s of owned) {
      const item = s.collectionItem!;
      const v =
        collectionItemValue(values.get(item.variantId)?.valueEur, { ...item, quantity: 1 }) ?? 0;
      valueEur += v;
      const key = item.variant.printing.imageKey;
      if (key && (v > best || cover === null)) {
        best = v;
        cover = key;
      }
    }
    return {
      id: b.id,
      name: b.name,
      color: b.color,
      rows: b.rows,
      cols: b.cols,
      pageCount: b._count.pages,
      cardCount: owned.length,
      wantCount: slots.filter((s) => s.placeholderVariantId).length,
      wantsFilled: slots.filter((s) => s.placeholderVariantId && s.collectionItem).length,
      valueEur,
      coverImageKey: b.coverKey ?? cover,
      setName: b.set?.name ?? null,
    };
  });
}

function cardHref(p: { collectorNumber: string; set: { code: string; game: { slug: string } } }) {
  return `/${p.set.game.slug}/${encodeURIComponent(p.set.code)}/${encodeURIComponent(cardSlug(p.collectorNumber))}`;
}

type VariantWithPrinting = {
  id: string;
  finish: string;
  printing: {
    collectorNumber: string;
    imageKey: string | null;
    card: { name: string };
    rarity: { name: string } | null;
    set: { name: string; code: string; game: { slug: string } };
  };
};

function toPocketCard(variant: VariantWithPrinting, valueEur: number | null): PocketCard {
  const p = variant.printing;
  return {
    name: p.card.name,
    number: p.collectorNumber,
    setName: p.set.name,
    rarity: p.rarity?.name ?? null,
    finish: variant.finish,
    imageKey: p.imageKey,
    href: cardHref(p),
    valueEur,
  };
}

export async function getBinder(id: string): Promise<BinderDetail | null> {
  const binder = await prisma.binder.findUnique({
    where: { id },
    include: {
      set: true,
      pages: {
        orderBy: { pageIndex: "asc" },
        include: { slots: { include: slotInclude } },
      },
    },
  });
  if (!binder) return null;

  const slots = binder.pages.flatMap((p) => p.slots);
  const wantIds = [
    ...new Set(slots.flatMap((s) => (s.placeholderVariantId ? [s.placeholderVariantId] : []))),
  ];
  const wants = await inChunks(wantIds, (chunk) =>
    prisma.printVariant.findMany({ where: { id: { in: chunk } }, include: variantInclude }),
  );
  const wantById = new Map(wants.map((w) => [w.id, w]));
  const values = await latestValuations([
    ...wantIds,
    ...slots.flatMap((s) => (s.collectionItem ? [s.collectionItem.variantId] : [])),
  ]);

  let valueEur = 0;
  const pages = binder.pages.map((page) =>
    page.slots
      .map<Pocket>((s) => {
        const item = s.collectionItem;
        const itemValue = item
          ? collectionItemValue(values.get(item.variantId)?.valueEur, { ...item, quantity: 1 })
          : null;
        valueEur += itemValue ?? 0;
        const want = s.placeholderVariantId ? wantById.get(s.placeholderVariantId) : undefined;
        return {
          position: s.position,
          item: item
            ? {
                ...toPocketCard(item.variant, itemValue),
                collectionItemId: item.id,
                condition: item.condition,
              }
            : null,
          want: want
            ? { ...toPocketCard(want, values.get(want.id)?.valueEur ?? null), variantId: want.id }
            : null,
        };
      })
      .sort((a, b) => a.position - b.position),
  );

  return {
    id: binder.id,
    name: binder.name,
    color: binder.color,
    rows: binder.rows,
    cols: binder.cols,
    setName: binder.set?.name ?? null,
    pages,
    valueEur,
  };
}

/** Collection items with copies not yet placed in any binder (for the binder's "Your cards" drawer). */
export async function availableCards(): Promise<AvailableCard[]> {
  const [items, used] = await Promise.all([
    prisma.collectionItem.findMany({
      orderBy: { createdAt: "desc" },
      include: { variant: { include: variantInclude } },
    }),
    slotsUsedByItem(),
  ]);
  const values = await latestValuations(items.map((i) => i.variantId));
  return items
    .map((i) => ({
      ...toPocketCard(
        i.variant,
        collectionItemValue(values.get(i.variantId)?.valueEur, { ...i, quantity: 1 }),
      ),
      collectionItemId: i.id,
      available: i.quantity - (used.get(i.id) ?? 0),
      condition: i.condition,
    }))
    .filter((c) => c.available > 0);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createBinder(input: {
  name: string;
  color: string;
  rows: number;
  cols: number;
  pages: number;
}): Promise<string> {
  const name = input.name.trim() || "My binder";
  assertLayout(input.rows, input.cols);
  assertColor(input.color);
  const pageCount = Math.min(MAX_PAGES, Math.max(1, Math.floor(input.pages)));
  const last = await prisma.binder.aggregate({ _max: { sortOrder: true } });
  const binder = await prisma.binder.create({
    data: {
      name,
      color: input.color,
      rows: input.rows,
      cols: input.cols,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      pages: { create: Array.from({ length: pageCount }, (_, pageIndex) => ({ pageIndex })) },
    },
  });
  return binder.id;
}

/**
 * A binder laid out like the set: one pocket per printing in set order,
 * each a "want" for that card, filled with an owned copy where the
 * collection has a spare one (preferring the matching finish).
 */
export async function createBinderFromSet(input: {
  setId: number;
  color: string;
  rows: number;
  cols: number;
  name?: string;
}): Promise<string> {
  assertLayout(input.rows, input.cols);
  assertColor(input.color);
  const set = await prisma.set.findUniqueOrThrow({
    where: { id: input.setId },
    include: {
      printings: {
        orderBy: [{ sortNumber: "asc" }, { collectorNumber: "asc" }],
        include: { variants: true },
      },
    },
  });
  const perPage = input.rows * input.cols;
  const pageCount = Math.max(1, Math.ceil(set.printings.length / perPage));
  const binderId = await createBinder({
    name: input.name?.trim() || set.name,
    color: input.color,
    rows: input.rows,
    cols: input.cols,
    pages: pageCount,
  });
  await prisma.binder.update({ where: { id: binderId }, data: { setId: set.id } });

  const pages = await prisma.binderPage.findMany({
    where: { binderId },
    orderBy: { pageIndex: "asc" },
  });

  // Spare owned copies per printing.
  const printingIds = set.printings.map((p) => p.id);
  const [items, used] = await Promise.all([
    inChunks(printingIds, (chunk) =>
      prisma.collectionItem.findMany({
        where: { variant: { printingId: { in: chunk } } },
        include: { variant: true },
        orderBy: { createdAt: "asc" },
      }),
    ).then((rows) => rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
    slotsUsedByItem(),
  ]);
  const spare = new Map<string, { id: string; finish: string; left: number }[]>();
  for (const item of items) {
    const left = item.quantity - (used.get(item.id) ?? 0);
    if (left <= 0) continue;
    const list = spare.get(item.variant.printingId) ?? [];
    list.push({ id: item.id, finish: item.variant.finish, left });
    spare.set(item.variant.printingId, list);
  }

  const FINISH_RANK = ["NON_FOIL", "HOLO", "REVERSE_HOLO"];
  const rank = (f: string) => (FINISH_RANK.includes(f) ? FINISH_RANK.indexOf(f) : 9);

  await prisma.$transaction(
    set.printings.map((printing, i) => {
      // The pocket is "for" the printing's main finish.
      const wantVariant = [...printing.variants].sort((a, b) => rank(a.finish) - rank(b.finish))[0];
      const candidates = spare.get(printing.id) ?? [];
      const match =
        candidates.find((c) => c.left > 0 && c.finish === wantVariant?.finish) ??
        candidates.find((c) => c.left > 0);
      if (match) match.left--;
      return prisma.binderSlot.create({
        data: {
          pageId: pages[Math.floor(i / perPage)]!.id,
          position: i % perPage,
          placeholderVariantId: wantVariant?.id ?? null,
          collectionItemId: match?.id ?? null,
        },
      });
    }),
  );
  return binderId;
}

export async function updateBinder(
  id: string,
  data: { name?: string; color?: string },
): Promise<void> {
  if (data.color) assertColor(data.color);
  await prisma.binder.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() || "My binder" } : {}),
      ...(data.color ? { color: data.color } : {}),
    },
  });
}

export async function deleteBinder(id: string): Promise<void> {
  // Pages and pockets cascade; the cards themselves stay in the collection.
  await prisma.binder.delete({ where: { id } });
}

/** Adds `count` empty pages at the end. */
export async function addBinderPages(binderId: string, count = 2): Promise<void> {
  const pages = await prisma.binderPage.count({ where: { binderId } });
  const add = Math.max(0, Math.min(count, MAX_PAGES - pages));
  await prisma.binderPage.createMany({
    data: Array.from({ length: add }, (_, i) => ({ binderId, pageIndex: pages + i })),
  });
}

/** Removes trailing pages that are completely empty (keeps at least one). */
export async function trimEmptyBinderPages(binderId: string): Promise<number> {
  const pages = await prisma.binderPage.findMany({
    where: { binderId },
    orderBy: { pageIndex: "desc" },
    include: { _count: { select: { slots: true } } },
  });
  const removable: string[] = [];
  for (const page of pages.slice(0, -1)) {
    if (page._count.slots > 0) break;
    removable.push(page.id);
  }
  await inChunks(removable, async (chunk) => {
    await prisma.binderPage.deleteMany({ where: { id: { in: chunk } } });
    return [];
  });
  return removable.length;
}

/** The page's id; also checks `position` (when given) fits the binder's layout. */
async function pageId(binderId: string, pageIndex: number, position?: number) {
  const page = await prisma.binderPage.findUnique({
    where: { binderId_pageIndex: { binderId, pageIndex } },
    include: { binder: true },
  });
  if (!page) throw new Error(`Binder page ${pageIndex} doesn't exist`);
  const perPage = page.binder.rows * page.binder.cols;
  if (position !== undefined && (position < 0 || position >= perPage)) {
    throw new Error(`Pocket ${position} is outside a ${perPage}-pocket page`);
  }
  return page.id;
}

/**
 * Puts one copy of a collection item into a pocket. An owned copy already
 * there goes back to the drawer; the pocket's "want" is kept.
 */
export async function placeCard(input: {
  binderId: string;
  pageIndex: number;
  position: number;
  collectionItemId: string;
}): Promise<void> {
  const pid = await pageId(input.binderId, input.pageIndex, input.position);
  const [item, usedCount] = await Promise.all([
    prisma.collectionItem.findUniqueOrThrow({ where: { id: input.collectionItemId } }),
    prisma.binderSlot.count({ where: { collectionItemId: input.collectionItemId } }),
  ]);
  const existing = await prisma.binderSlot.findUnique({
    where: { pageId_position: { pageId: pid, position: input.position } },
  });
  // Re-placing the same item in its own pocket is a no-op, not a new copy.
  if (existing?.collectionItemId === item.id) return;
  if (usedCount >= item.quantity) {
    throw new Error(`All ${item.quantity} of this card are already in binders`);
  }
  await prisma.binderSlot.upsert({
    where: { pageId_position: { pageId: pid, position: input.position } },
    update: { collectionItemId: item.id },
    create: { pageId: pid, position: input.position, collectionItemId: item.id },
  });
}

/**
 * Moves a pocket's contents (owned copy *and* want) to another pocket in the
 * same binder, swapping with whatever is there. One transaction.
 */
export async function movePocket(input: {
  binderId: string;
  from: { pageIndex: number; position: number };
  to: { pageIndex: number; position: number };
}): Promise<void> {
  const fromPage = await pageId(input.binderId, input.from.pageIndex, input.from.position);
  const toPage = await pageId(input.binderId, input.to.pageIndex, input.to.position);
  if (fromPage === toPage && input.from.position === input.to.position) return;

  await interactiveTransaction(async (tx) => {
    const a = await tx.binderSlot.findUnique({
      where: { pageId_position: { pageId: fromPage, position: input.from.position } },
    });
    const b = await tx.binderSlot.findUnique({
      where: { pageId_position: { pageId: toPage, position: input.to.position } },
    });
    if (a) await tx.binderSlot.delete({ where: { id: a.id } });
    if (b) await tx.binderSlot.delete({ where: { id: b.id } });
    if (a) {
      await tx.binderSlot.create({
        data: {
          pageId: toPage,
          position: input.to.position,
          collectionItemId: a.collectionItemId,
          placeholderVariantId: a.placeholderVariantId,
        },
      });
    }
    if (b) {
      await tx.binderSlot.create({
        data: {
          pageId: fromPage,
          position: input.from.position,
          collectionItemId: b.collectionItemId,
          placeholderVariantId: b.placeholderVariantId,
        },
      });
    }
  });
}

/** Takes the owned copy out of a pocket (back to "Your cards"); a want stays. */
export async function removeFromPocket(input: {
  binderId: string;
  pageIndex: number;
  position: number;
}): Promise<void> {
  const pid = await pageId(input.binderId, input.pageIndex);
  const slot = await prisma.binderSlot.findUnique({
    where: { pageId_position: { pageId: pid, position: input.position } },
  });
  if (!slot) return;
  if (slot.placeholderVariantId) {
    await prisma.binderSlot.update({ where: { id: slot.id }, data: { collectionItemId: null } });
  } else {
    await prisma.binderSlot.delete({ where: { id: slot.id } });
  }
}

/** Marks a pocket as being for a card (variantId), or clears that (null). */
export async function setPocketWant(input: {
  binderId: string;
  pageIndex: number;
  position: number;
  variantId: string | null;
}): Promise<void> {
  const pid = await pageId(input.binderId, input.pageIndex, input.position);
  const slot = await prisma.binderSlot.findUnique({
    where: { pageId_position: { pageId: pid, position: input.position } },
  });
  if (input.variantId === null) {
    if (!slot) return;
    if (slot.collectionItemId) {
      await prisma.binderSlot.update({
        where: { id: slot.id },
        data: { placeholderVariantId: null },
      });
    } else {
      await prisma.binderSlot.delete({ where: { id: slot.id } });
    }
    return;
  }
  await prisma.printVariant.findUniqueOrThrow({ where: { id: input.variantId } });
  await prisma.binderSlot.upsert({
    where: { pageId_position: { pageId: pid, position: input.position } },
    update: { placeholderVariantId: input.variantId },
    create: { pageId: pid, position: input.position, placeholderVariantId: input.variantId },
  });
}

/** Catalog search for "mark this pocket as wanted": variants by card name. */
export async function searchVariants(query: string, limit = 24) {
  const q = query.trim();
  if (!q) return [];
  const variants = await prisma.printVariant.findMany({
    where: { printing: { card: { name: { contains: q } } } },
    include: variantInclude,
    take: limit,
    orderBy: [{ printing: { set: { releaseDate: "desc" } } }, { printing: { sortNumber: "asc" } }],
  });
  return variants.map((v) => ({ variantId: v.id, ...toPocketCard(v, null) }));
}
