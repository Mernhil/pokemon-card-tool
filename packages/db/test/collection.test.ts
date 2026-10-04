import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { addCopies, adjustCopies, deleteCollectionItem, removeCopies } from "../src/collection";
import { resetDb } from "./helpers";

afterAll(() => prisma.$disconnect());

let variantId: string;

/** One printing with a single variant, and a 3x3 binder page to put copies in. */
beforeEach(async () => {
  await resetDb();
  const game = await prisma.game.create({ data: { slug: "pokemon", name: "Pokémon" } });
  await prisma.language.create({ data: { code: "en", name: "English" } });
  const set = await prisma.set.create({ data: { gameId: game.id, code: "t1", name: "Test" } });
  const card = await prisma.card.create({
    data: { gameId: game.id, name: "Pikachu", cardType: "Pokemon", canonicalKey: "pika" },
  });
  const printing = await prisma.printing.create({
    data: { cardId: card.id, setId: set.id, collectorNumber: "1", sortNumber: 1 },
  });
  const v = await prisma.printVariant.create({
    data: { printingId: printing.id, finish: "NON_FOIL", languageCode: "en" },
  });
  variantId = v.id;
});

const items = () =>
  prisma.collectionItem.findMany({ where: { variantId }, orderBy: { id: "asc" } });

describe("adjustCopies", () => {
  it("creates a near-mint row on the first +1, then increments it", async () => {
    expect(await adjustCopies(variantId, 1)).toEqual({ plain: 1, total: 1 });
    const row = (await items())[0]!;
    expect(row).toMatchObject({ quantity: 1, condition: "NEAR_MINT", gradingCompany: null });
    expect(row.acquiredAt).toBeInstanceOf(Date);

    expect(await adjustCopies(variantId, 1)).toEqual({ plain: 2, total: 2 });
    expect(await items()).toHaveLength(1);
  });

  it("ten rapid clicks coalesced or not end on the same count", async () => {
    for (let i = 0; i < 6; i++) await adjustCopies(variantId, 1);
    await adjustCopies(variantId, 4);
    await adjustCopies(variantId, -3);
    expect((await items()).reduce((s, r) => s + r.quantity, 0)).toBe(7);
  });

  it("increments an existing plain row of any condition instead of creating one", async () => {
    await prisma.collectionItem.create({ data: { variantId, quantity: 2, condition: "PLAYED" } });
    await adjustCopies(variantId, 1);
    const rows = await items();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 3, condition: "PLAYED" });
  });

  it("adds a plain row next to graded copies, leaving the slab alone", async () => {
    await prisma.collectionItem.create({
      data: { variantId, quantity: 1, gradingCompany: "PSA", grade: 10, certNumber: "123" },
    });
    expect(await adjustCopies(variantId, 1)).toEqual({ plain: 1, total: 2 });
    const rows = await items();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.gradingCompany === "PSA")?.quantity).toBe(1);
  });

  it("removes one copy, and deletes the row at zero", async () => {
    await prisma.collectionItem.create({ data: { variantId, quantity: 2 } });
    expect(await adjustCopies(variantId, -1)).toEqual({ plain: 1, total: 1 });
    expect(await adjustCopies(variantId, -1)).toEqual({ plain: 0, total: 0 });
    expect(await items()).toHaveLength(0);
  });

  it("refuses to remove graded-only copies, and changes nothing", async () => {
    await prisma.collectionItem.create({
      data: { variantId, quantity: 1, gradingCompany: "PSA", grade: 9, certNumber: "9" },
    });
    await expect(adjustCopies(variantId, -1)).rejects.toThrow(/graded copies/);
    expect(await items()).toHaveLength(1);
  });

  it("is all-or-nothing when asked to remove more than exist", async () => {
    await prisma.collectionItem.create({ data: { variantId, quantity: 2 } });
    await expect(adjustCopies(variantId, -3)).rejects.toThrow(/Only 2/);
    expect((await items())[0]!.quantity).toBe(2);
  });

  it("rejects unknown variants and bad deltas", async () => {
    await expect(adjustCopies("nope", 1)).rejects.toThrow();
    await expect(adjustCopies(variantId, 0)).rejects.toThrow();
    await expect(adjustCopies(variantId, 1.5)).rejects.toThrow();
  });
});

describe("binder pockets", () => {
  /** A page with `n` pockets each holding a copy of `itemId`; the first also wants the variant. */
  async function pockets(itemId: string, n: number) {
    const binder = await prisma.binder.create({ data: { name: "B" } });
    const page = await prisma.binderPage.create({ data: { binderId: binder.id, pageIndex: 0 } });
    for (let position = 0; position < n; position++) {
      await prisma.binderSlot.create({
        data: {
          pageId: page.id,
          position,
          collectionItemId: itemId,
          placeholderVariantId: position === 0 ? variantId : null,
        },
      });
    }
  }

  it("frees pockets when the last copy is removed; a 'want' stays", async () => {
    const item = await prisma.collectionItem.create({ data: { variantId, quantity: 2 } });
    await pockets(item.id, 2);
    await adjustCopies(variantId, -2);
    const slots = await prisma.binderSlot.findMany();
    expect(slots).toHaveLength(1);
    expect(slots[0]!).toMatchObject({ collectionItemId: null, placeholderVariantId: variantId });
  });

  it("releases only the surplus pockets on a partial removal", async () => {
    const item = await prisma.collectionItem.create({ data: { variantId, quantity: 3 } });
    await pockets(item.id, 3);
    await adjustCopies(variantId, -1);
    expect(await prisma.binderSlot.count({ where: { collectionItemId: item.id } })).toBe(2);
  });

  it("deleteCollectionItem releases pockets too", async () => {
    const item = await prisma.collectionItem.create({ data: { variantId, quantity: 1 } });
    await pockets(item.id, 1);
    await deleteCollectionItem(item.id);
    expect(await prisma.binderSlot.count({ where: { collectionItemId: item.id } })).toBe(0);
    expect(await items()).toHaveLength(0);
  });
});

describe("addCopies / removeCopies", () => {
  it("merges into a plain row of the same condition, and undoes exactly that", async () => {
    const first = await addCopies(variantId, 2, "LIGHTLY_PLAYED");
    expect(await addCopies(variantId, 1, "LIGHTLY_PLAYED")).toBe(first);
    const other = await addCopies(variantId, 1, "NEAR_MINT");
    expect(other).not.toBe(first);
    expect((await prisma.collectionItem.findUniqueOrThrow({ where: { id: first } })).quantity).toBe(3);

    await removeCopies(first, 1);
    expect((await prisma.collectionItem.findUniqueOrThrow({ where: { id: first } })).quantity).toBe(2);
    await removeCopies(other, 1);
    expect(await prisma.collectionItem.findUnique({ where: { id: other } })).toBeNull();
  });
});
