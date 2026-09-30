"use server";

import { revalidatePath } from "next/cache";
import {
  adjustCopies,
  deleteCollectionItem,
  prisma,
  releaseBinderCopies,
  snapshotPortfolio,
} from "@tcg-vault/db";
import { CONDITIONS, GRADING_COMPANIES } from "@tcg-vault/shared";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function attempt(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function run(fn: () => Promise<void>): Promise<ActionResult> {
  const result = await attempt(fn);
  if (!result.ok) return result;
  try {
    // Today's dashboard point reflects the collection as it is now, not as
    // it was at the last price sync.
    await snapshotPortfolio();
    // Card pages, collection, binders, dashboard and home all show this data.
    revalidatePath("/", "layout");
    return result;
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

export async function updateCollectionItemAction(
  id: string,
  data: { quantity?: number; condition?: string | null },
): Promise<ActionResult> {
  return run(async () => {
    if (data.quantity !== undefined && data.quantity <= 0) {
      await deleteCollectionItem(id);
      return;
    }
    if (data.quantity !== undefined) await releaseBinderCopies(prisma, id, data.quantity);
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
    await deleteCollectionItem(id);
  });
}

/**
 * Tile quick add/remove: +1 / -1 (or a coalesced net delta) of ungraded copies.
 * Deliberately skips run()'s portfolio snapshot and layout revalidation — the
 * grid clicks this rapidly and calls settleQuickAddAction once the burst ends.
 */
export async function adjustCopiesAction(variantId: string, delta: number): Promise<ActionResult> {
  return attempt(async () => {
    if (typeof variantId !== "string" || !variantId) throw new Error("Missing variant");
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 999) {
      throw new Error("Invalid quantity change");
    }
    await adjustCopies(variantId, delta);
  });
}

/** One dashboard snapshot after a burst of quick adds (the client then refreshes the route). */
export async function settleQuickAddAction(): Promise<ActionResult> {
  return attempt(async () => {
    await snapshotPortfolio();
  });
}
