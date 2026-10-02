import type { Prisma } from "./generated/node/client";
import { prisma } from "./client";

/** Either the client or an interactive-transaction client. */
type Db = Prisma.TransactionClient;

/**
 * Copies of an item beyond `keep` come out of binder pockets (newest first);
 * a pocket's "want" stays, an otherwise-empty pocket row is removed.
 */
export async function releaseBinderCopies(db: Db, collectionItemId: string, keep: number) {
  const slots = await db.binderSlot.findMany({
    where: { collectionItemId },
    orderBy: { id: "desc" },
  });
  for (const slot of slots.slice(0, Math.max(0, slots.length - keep))) {
    if (slot.placeholderVariantId) {
      await db.binderSlot.update({ where: { id: slot.id }, data: { collectionItemId: null } });
    } else {
      await db.binderSlot.delete({ where: { id: slot.id } });
    }
  }
}

/** Deletes a collection row, freeing every binder pocket it occupied. */
export async function deleteCollectionItem(id: string, db?: Db): Promise<void> {
  if (!db) {
    await prisma.$transaction((tx) => deleteCollectionItem(id, tx));
    return;
  }
  await releaseBinderCopies(db, id, 0);
  await db.collectionItem.delete({ where: { id } });
}

export interface VariantCopies {
  /** Ungraded copies (no grading company, no cert). */
  plain: number;
  /** Every copy, graded or not. */
  total: number;
}

/**
 * Adds (`delta > 0`) or removes (`delta < 0`) ungraded copies of a variant.
 *
 * Only "plain" rows (no grading company, no cert) are ever touched: graded
 * copies are individual slabs and are managed on the card page.
 * - Adding bumps the oldest plain row, or creates a NEAR_MINT one.
 * - Removing takes from the newest plain rows first and deletes a row that
 *   reaches 0 (releasing its binder pockets). Asking for more than exist
 *   throws and changes nothing.
 * All-or-nothing, so a coalesced burst of clicks is one call.
 */
export async function adjustCopies(variantId: string, delta: number): Promise<VariantCopies> {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("delta must be a non-zero integer");
  return prisma.$transaction(async (tx) => {
    await tx.printVariant.findUniqueOrThrow({ where: { id: variantId } });
    const items = await tx.collectionItem.findMany({
      where: { variantId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const plainRows = items.filter((i) => i.gradingCompany === null && i.certNumber === null);

    if (delta > 0) {
      const row = plainRows[0];
      if (row) {
        await tx.collectionItem.update({
          where: { id: row.id },
          data: { quantity: { increment: delta } },
        });
      } else {
        await tx.collectionItem.create({
          data: { variantId, quantity: delta, condition: "NEAR_MINT", acquiredAt: new Date() },
        });
      }
    } else {
      let remaining = -delta;
      const available = plainRows.reduce((s, r) => s + r.quantity, 0);
      if (remaining > available) {
        throw new Error(
          available === 0
            ? "No ungraded copy to remove — graded copies are managed on the card page"
            : `Only ${available} ungraded ${available === 1 ? "copy" : "copies"} to remove`,
        );
      }
      for (const row of [...plainRows].reverse()) {
        if (remaining === 0) break;
        const take = Math.min(row.quantity, remaining);
        remaining -= take;
        if (take === row.quantity) {
          await deleteCollectionItem(row.id, tx);
        } else {
          await releaseBinderCopies(tx, row.id, row.quantity - take);
          await tx.collectionItem.update({
            where: { id: row.id },
            data: { quantity: row.quantity - take },
          });
        }
      }
    }

    const after = await tx.collectionItem.findMany({
      where: { variantId },
      select: { quantity: true, gradingCompany: true, certNumber: true },
    });
    const total = after.reduce((s, i) => s + i.quantity, 0);
    const plain = after
      .filter((i) => i.gradingCompany === null && i.certNumber === null)
      .reduce((s, i) => s + i.quantity, 0);
    return { plain, total };
  });
}
