"use server";

import {
  MAX_CUSTOM_IMAGE_BYTES,
  customImageErrorText,
  enqueuePriceRefresh,
  prisma,
  refreshGradedPrices,
  type GradedPriceSource,
  pricesUpdating,
  removeCustomImage,
  setCustomImage,
} from "@tcg-vault/db";
import { PRICE_PROVIDERS, type PriceProviderId } from "@tcg-vault/shared";
import { revalidatePath } from "next/cache";
import {
  cleanupOrphanedPriceRows,
  priceProviders,
  requestPriceRefresh,
  runnablePriceProviders,
  scheduleValuations,
} from "../../../../lib/background";

/**
 * "Refresh prices": queues these variants first for every provider that can
 * actually run (enabled, configured, supports the game) and starts the runs.
 * `started` is false when no provider can run, so the button doesn't wait.
 */
export async function refreshPricesAction(
  variantIds: string[],
  game: string,
): Promise<{ started: boolean }> {
  if (variantIds.length === 0 || variantIds.length > 20) return { started: false };
  const runnable = await runnablePriceProviders(game);
  await cleanupOrphanedPriceRows();
  if (runnable.length === 0) return { started: false };
  // A press on "Refresh prices" retries cards no provider could match before (the automatic
  // retry only comes after a week); mappings set by hand are kept.
  await prisma.providerMapping.deleteMany({
    where: { variantId: { in: variantIds }, status: "not_found", manualOverride: false },
  });
  await enqueuePriceRefresh(variantIds, game, runnable);
  requestPriceRefresh(runnable);
  return { started: true };
}

/** Polled by the "Updating…" indicator; true while a refresh for these is queued or running. */
export async function pricesUpdatingAction(variantIds: string[], game: string): Promise<boolean> {
  return pricesUpdating(variantIds.slice(0, 20), {
    game,
    providers: await runnablePriceProviders(game),
  });
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
  if ((await runnablePriceProviders(input.game)).includes(provider)) {
    await enqueuePriceRefresh([input.variantId], input.game, [provider]);
    requestPriceRefresh([provider]);
  }
  scheduleValuations();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** "Set custom image": validates (type by content, size) and stores the file on the printing. */
export async function setCustomImageAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const printingId = String(formData.get("printingId") ?? "");
  const file = formData.get("file");
  if (!printingId || !(file instanceof File)) return { ok: false, error: "Choose an image file." };
  if (file.size > MAX_CUSTOM_IMAGE_BYTES)
    return { ok: false, error: customImageErrorText("too-big") };
  const result = await setCustomImage(printingId, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return { ok: false, error: customImageErrorText(result.error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCustomImageAction(printingId: string): Promise<{ ok: boolean }> {
  const removed = await removeCustomImage(printingId);
  revalidatePath("/", "layout");
  return { ok: removed };
}

/**
 * "Load graded prices": asks eBay for PSA/BGS/CGC/SGC listings of this card
 * (a few calls), stores them, and reports what happened. Awaited on purpose —
 * it is one button press on one card, and the user waits for the table.
 */
export async function refreshGradedPricesAction(
  variantId: string,
  language: string,
): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  try {
    const { settings, providers } = await priceProviders();
    const ebay = providers.ebay;
    if (!settings.providers.ebay.enabled)
      return { ok: false, error: "eBay is turned off in Settings." };
    if (!ebay.isConfigured())
      return { ok: false, error: "Add your eBay keys in Settings to load graded prices." };
    if (!("fetchGradedPrices" in ebay))
      return { ok: false, error: "This eBay provider can't do graded prices." };
    const rows = await refreshGradedPrices(ebay as GradedPriceSource, variantId, language);
    revalidatePath("/", "layout");
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
