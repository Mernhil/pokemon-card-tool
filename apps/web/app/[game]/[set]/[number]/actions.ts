"use server";

import { enqueuePriceRefresh, prisma, pricesUpdating } from "@tcg-vault/db";
import { PRICE_PROVIDERS, type PriceProviderId } from "@tcg-vault/shared";
import { revalidatePath } from "next/cache";
import { requestPriceRefresh, scheduleValuations } from "../../../../lib/background";

/** "Refresh prices": queues these variants first for every provider and starts the runs. */
export async function refreshPricesAction(variantIds: string[], game: string): Promise<void> {
  if (variantIds.length === 0 || variantIds.length > 20) return;
  await enqueuePriceRefresh(variantIds, game);
  requestPriceRefresh();
}

/** Polled by the "Updating…" indicator; true while a refresh for these is queued or running. */
export async function pricesUpdatingAction(variantIds: string[]): Promise<boolean> {
  return pricesUpdating(variantIds.slice(0, 20));
}

/**
 * "Wrong match?": sets a provider's mapping by hand (product/blueprint id,
 * or search query for eBay) — kept as is by every later refresh — or with
 * both empty, clears it so it's matched automatically again.
 */
export async function setMappingAction(input: {
  variantId: string;
  provider: string;
  externalId: string;
  query: string;
  game: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(PRICE_PROVIDERS as readonly string[]).includes(input.provider)) {
    return { ok: false, error: "Unknown provider" };
  }
  const provider = input.provider as PriceProviderId;
  const externalId = input.externalId.trim() || null;
  const query = input.query.trim() || null;
  const where = { variantId_provider: { variantId: input.variantId, provider } };
  if (!externalId && !query) {
    await prisma.providerMapping.deleteMany({ where: { variantId: input.variantId, provider } });
  } else {
    const data = {
      externalId,
      query,
      url: null,
      confidence: 1,
      status: "matched",
      manualOverride: true,
      notes: "Set by hand",
      resolvedAt: new Date(),
    };
    await prisma.providerMapping.upsert({
      where,
      update: data,
      create: { variantId: input.variantId, provider, ...data },
    });
  }
  // A new mapping means earlier numbers may belong to another card: refetch now.
  await enqueuePriceRefresh([input.variantId], input.game);
  requestPriceRefresh([provider]);
  scheduleValuations();
  revalidatePath("/", "layout");
  return { ok: true };
}
