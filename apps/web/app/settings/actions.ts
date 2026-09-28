"use server";

import {
  SECRET_NAMES,
  updateSettings,
  writeSecret,
  type AppSettings,
  type SecretName,
} from "@tcg-vault/db";
import { PRICE_PROVIDERS, type PriceProviderId } from "@tcg-vault/shared";
import { revalidatePath } from "next/cache";
import { priceProviders, requestFxRefresh, requestPriceRefresh } from "../../lib/background";
import { loadMoneyDisplay } from "../../lib/money-config";

export type SettingsResult = { ok: true } | { ok: false; error: string };

/** Saves non-secret settings (validated and clamped in @tcg-vault/db). */
export async function saveSettingsAction(patch: Partial<AppSettings>): Promise<SettingsResult> {
  try {
    await updateSettings(patch);
    await loadMoneyDisplay();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stores (or with an empty value, removes) one API key/token in
 * secrets.json. The value is never logged and never sent back to the page —
 * only its masked form is shown afterwards.
 */
export async function saveSecretAction(name: string, value: string): Promise<SettingsResult> {
  if (!(SECRET_NAMES as readonly string[]).includes(name))
    return { ok: false, error: "Unknown key" };
  if (value.length > 1_000) return { ok: false, error: "That doesn't look like a key (too long)" };
  try {
    await writeSecret(name as SecretName, value || null);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    // The error is about the file (permissions, disk), never contains the value.
    return {
      ok: false,
      error: `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** One cheap authenticated request with the stored credentials. */
export async function testConnectionAction(
  provider: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(PRICE_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, message: "Unknown provider" };
  }
  const { providers } = await priceProviders();
  return providers[provider as PriceProviderId].testConnection();
}

/** "Refresh prices" for the whole collection now (only stale cards are fetched). */
export async function refreshAllPricesAction(): Promise<void> {
  requestFxRefresh();
  requestPriceRefresh();
}
