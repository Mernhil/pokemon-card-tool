"use server";

import { prisma, setWishlistTarget } from "@tcg-vault/db";
import { revalidatePath } from "next/cache";

/** Adds or removes a printing from the wishlist; returns whether it is wishlisted afterwards. */
export async function toggleWishlistAction(
  printingId: string,
): Promise<{ wishlisted: boolean }> {
  const existing = await prisma.wishlistItem.findUnique({ where: { printingId } });
  if (existing) {
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
  } else {
    const printing = await prisma.printing.findUnique({
      where: { id: printingId },
      select: { id: true },
    });
    if (!printing) return { wishlisted: false };
    await prisma.wishlistItem.create({ data: { printingId } });
  }
  revalidatePath("/wishlist");
  revalidatePath("/", "layout");
  return { wishlisted: !existing };
}

/** Sets (or with null, clears) the deal-finder target for a wishlist card, in euros. */
export async function setWishlistTargetAction(
  printingId: string,
  eur: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (eur !== null && !Number.isFinite(eur)) return { ok: false, error: "Enter a number" };
  try {
    await setWishlistTarget(printingId, eur);
    revalidatePath("/wishlist");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
