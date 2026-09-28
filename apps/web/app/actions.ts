"use server";

import { revalidatePath } from "next/cache";
import { prisma, snapshotPortfolio } from "@tcg-vault/db";
import { CONDITIONS, GRADING_COMPANIES } from "@tcg-vault/shared";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    // Today's dashboard point reflects the collection as it is now, not as
    // it was at the last price sync.
    await snapshotPortfolio();
    // Card pages, collection, binders, dashboard and home all show this data.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface AddToCollectionInput {
  variantId: string;
  quantity?: number;
  condition?: string | null;
  gradingCompany?: string | null;
  grade?: number | null;
  /** Per card, in EUR (major units, e.g. 12.5). */
  pricePaid?: number | null;
  notes?: string | null;
}

export async function addToCollectionAction(input: AddToCollectionInput): Promise<ActionResult> {
  return run(async () => {
    await prisma.printVariant.findUniqueOrThrow({ where: { id: input.variantId } });
    const quantity = Math.max(1, Math.floor(input.quantity ?? 1) || 1);
    const gradingCompany =
      input.gradingCompany &&
      (GRADING_COMPANIES as readonly string[]).includes(input.gradingCompany)
        ? input.gradingCompany
        : null;
    const condition =
      !gradingCompany &&
      input.condition &&
      (CONDITIONS as readonly string[]).includes(input.condition)
        ? input.condition
        : null;
    const paid =
      input.pricePaid !== null &&
      input.pricePaid !== undefined &&
      Number.isFinite(input.pricePaid) &&
      input.pricePaid >= 0
        ? Math.round(input.pricePaid * 100)
        : null;
    await prisma.collectionItem.create({
      data: {
        variantId: input.variantId,
        quantity,
        condition,
        gradingCompany,
        grade: gradingCompany && input.grade ? input.grade : null,
        notes: input.notes?.trim() || null,
        purchasePrice: paid,
        purchaseCurrency: paid !== null ? "EUR" : null,
        acquiredAt: new Date(),
      },
    });
  });
}

/**
 * Copies of an item beyond `keep` come out of binder pockets (newest first);
 * a pocket's "want" stays, an otherwise-empty pocket row is removed.
 */
async function releaseBinderCopies(collectionItemId: string, keep: number) {
  const slots = await prisma.binderSlot.findMany({
    where: { collectionItemId },
    orderBy: { id: "desc" },
  });
  for (const slot of slots.slice(0, Math.max(0, slots.length - keep))) {
    if (slot.placeholderVariantId) {
      await prisma.binderSlot.update({ where: { id: slot.id }, data: { collectionItemId: null } });
    } else {
      await prisma.binderSlot.delete({ where: { id: slot.id } });
    }
  }
}

export async function updateCollectionItemAction(
  id: string,
  data: { quantity?: number; condition?: string | null },
): Promise<ActionResult> {
  return run(async () => {
    if (data.quantity !== undefined && data.quantity <= 0) {
      await releaseBinderCopies(id, 0);
      await prisma.collectionItem.delete({ where: { id } });
      return;
    }
    if (data.quantity !== undefined) await releaseBinderCopies(id, data.quantity);
    await prisma.collectionItem.update({
      where: { id },
      data: {
        ...(data.quantity !== undefined ? { quantity: Math.floor(data.quantity) } : {}),
        ...(data.condition !== undefined
          ? {
              condition:
                data.condition && (CONDITIONS as readonly string[]).includes(data.condition)
                  ? data.condition
                  : null,
            }
          : {}),
      },
    });
  });
}

export async function deleteCollectionItemAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await releaseBinderCopies(id, 0);
    await prisma.collectionItem.delete({ where: { id } });
  });
}
