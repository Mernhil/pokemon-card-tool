import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_BULK_THRESHOLD,
  DEFAULT_PRICE_LANGUAGE,
  PRICE_PROVIDERS,
  appDataDir,
  isPriceLanguage,
  type PriceLanguage,
  type PriceProviderId,
} from "@tcg-vault/shared";
import { prisma } from "./client";

/**
 * App settings. Two stores, on purpose:
 * - Non-secret settings (currency, cadence, enabled providers) in the
 *   AppSetting table, as one JSON document.
 * - API keys/tokens in `secrets.json` in the app data directory (never the
 *   database, never the repo, never the installer): owner-only permissions,
 *   written atomically, never logged, and only ever shown masked.
 *   Environment variables (CARDTRADER_API_TOKEN, EBAY_CLIENT_ID,
 *   EBAY_CLIENT_SECRET) are a fallback for development/CI.
 */

export interface AppSettings {
  /** ISO currency every converted price is shown in. */
  displayCurrency: string;
  /**
   * The language prices and values are quoted in (default English): CardTrader/eBay numbers
   * are taken from listings in this language, so cheap copies in other languages don't
   * pollute values. Cardmarket/TCGplayer can't split by language and stay "all languages".
   */
  priceLanguage: PriceLanguage;
  /** Collection (and recently viewed) cards' prices are refreshed this often. */
  priceRefreshHours: number;
  /** A card page with prices older than this queues a refresh when opened. */
  staleAfterHours: number;
  /** Sets are re-synced once their last sync is older than this. */
  catalogRefreshDays: number;
  imageCacheMaxMb: number;
  /** Show the digital-only Pokémon TCG Pocket sets (off hides that section entirely). */
  showPocketSets: boolean;
  /** Collection cards worth less than this each (EUR minor units) fold into the Bulk section; 0 = off. */
  bulkThresholdCents: number;
  providers: Record<PriceProviderId, { enabled: boolean }>;
  ebay: {
    /** EBAY_US, EBAY_GB, EBAY_DE, EBAY_IT, EBAY_FR, EBAY_ES, ... */
    marketplaceId: string;
    environment: "production" | "sandbox";
  };
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function defaultSettings(): AppSettings {
  return {
    displayCurrency: "EUR",
    priceLanguage: DEFAULT_PRICE_LANGUAGE,
    priceRefreshHours: 24,
    staleAfterHours: 24,
    catalogRefreshDays: envNumber("CATALOG_REFRESH_DAYS", 30),
    imageCacheMaxMb: envNumber("IMAGE_CACHE_MAX_MB", 500),
    showPocketSets: true,
    bulkThresholdCents: DEFAULT_BULK_THRESHOLD,
    providers: {
      cardmarket: { enabled: true },
      tcgplayer: { enabled: true },
      cardtrader: { enabled: true },
      ebay: { enabled: true },
    },
    ebay: { marketplaceId: "EBAY_US", environment: "production" },
  };
}

export const EBAY_MARKETPLACES = [
  "EBAY_US",
  "EBAY_GB",
  "EBAY_DE",
  "EBAY_IT",
  "EBAY_FR",
  "EBAY_ES",
  "EBAY_NL",
  "EBAY_AT",
  "EBAY_BE",
  "EBAY_IE",
  "EBAY_PL",
  "EBAY_CH",
  "EBAY_CA",
  "EBAY_AU",
] as const;

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Merges untrusted input (a form, an old stored document) onto valid settings. */
export function sanitizeSettings(
  input: unknown,
  base: AppSettings = defaultSettings(),
): AppSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const providersIn = (raw.providers ?? {}) as Record<string, { enabled?: unknown } | undefined>;
  const ebayIn = (raw.ebay ?? {}) as Record<string, unknown>;
  const currency = typeof raw.displayCurrency === "string" ? raw.displayCurrency.toUpperCase() : "";
  return {
    displayCurrency: /^[A-Z]{3}$/.test(currency) ? currency : base.displayCurrency,
    priceLanguage: isPriceLanguage(raw.priceLanguage) ? raw.priceLanguage : base.priceLanguage,
    priceRefreshHours: clamp(raw.priceRefreshHours, 1, 24 * 30, base.priceRefreshHours),
    staleAfterHours: clamp(raw.staleAfterHours, 1, 24 * 30, base.staleAfterHours),
    catalogRefreshDays: clamp(raw.catalogRefreshDays, 1, 365, base.catalogRefreshDays),
    imageCacheMaxMb: clamp(raw.imageCacheMaxMb, 50, 100_000, base.imageCacheMaxMb),
    showPocketSets:
      typeof raw.showPocketSets === "boolean" ? raw.showPocketSets : base.showPocketSets,
    bulkThresholdCents: clamp(raw.bulkThresholdCents, 0, 1_000_000, base.bulkThresholdCents),
    providers: Object.fromEntries(
      PRICE_PROVIDERS.map((id) => [
        id,
        {
          enabled:
            typeof providersIn[id]?.enabled === "boolean"
              ? (providersIn[id]!.enabled as boolean)
              : base.providers[id].enabled,
        },
      ]),
    ) as AppSettings["providers"],
    ebay: {
      marketplaceId:
        typeof ebayIn.marketplaceId === "string" &&
        (EBAY_MARKETPLACES as readonly string[]).includes(ebayIn.marketplaceId)
          ? ebayIn.marketplaceId
          : base.ebay.marketplaceId,
      environment:
        ebayIn.environment === "sandbox" || ebayIn.environment === "production"
          ? ebayIn.environment
          : base.ebay.environment,
    },
  };
}

const SETTINGS_KEY = "settings";
let cached: { at: number; value: AppSettings } | null = null;

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  let stored: unknown = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {
    stored = {};
  }
  const value = sanitizeSettings(stored);
  cached = { at: Date.now(), value };
  return value;
}

/** Same as getSettings, but reuses a read from the last few seconds (per-image-request callers). */
export async function getSettingsCached(maxAgeMs = 30_000): Promise<AppSettings> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;
  return getSettings();
}

export async function updateSettings(patch: unknown): Promise<AppSettings> {
  const current = await getSettings();
  const raw = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const next = sanitizeSettings(
    {
      ...current,
      ...raw,
      providers: { ...current.providers, ...((raw.providers as object) ?? {}) },
      ebay: { ...current.ebay, ...((raw.ebay as object) ?? {}) },
    },
    current,
  );
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
  });
  cached = { at: Date.now(), value: next };
  return next;
}

// ---------- secrets ----------

export const SECRET_NAMES = ["cardtraderToken", "ebayClientId", "ebayClientSecret"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export type Secrets = Partial<Record<SecretName, string>>;

const ENV_FALLBACK: Record<SecretName, string> = {
  cardtraderToken: "CARDTRADER_API_TOKEN",
  ebayClientId: "EBAY_CLIENT_ID",
  ebayClientSecret: "EBAY_CLIENT_SECRET",
};

export function secretsPath(): string {
  return process.env.TCG_VAULT_SECRETS_FILE ?? join(appDataDir(), "secrets.json");
}

async function readSecretsFile(): Promise<Secrets> {
  try {
    const parsed: unknown = JSON.parse(await readFile(secretsPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    const out: Secrets = {};
    for (const name of SECRET_NAMES) {
      const value = (parsed as Record<string, unknown>)[name];
      if (typeof value === "string" && value) out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Server-only: the actual secret values (file first, then environment). Never send these to a page. */
export async function readSecrets(): Promise<Secrets> {
  const file = await readSecretsFile();
  const out: Secrets = {};
  for (const name of SECRET_NAMES) {
    const value = file[name] ?? process.env[ENV_FALLBACK[name]];
    if (value) out[name] = value;
  }
  return out;
}

/** Sets (or with null/empty, removes) one secret. Atomic, owner-only file. */
export async function writeSecret(name: SecretName, value: string | null): Promise<void> {
  const current = await readSecretsFile();
  const trimmed = value?.trim();
  if (trimmed) current[name] = trimmed;
  else delete current[name];
  const path = secretsPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
  await rename(tmp, path);
  // mode on create doesn't apply to an existing file; tighten it (no-op on Windows).
  await chmod(path, 0o600).catch(() => {});
}

/** "••••••ab12": enough to recognise which key it is, never enough to use it. */
export function maskSecret(value: string): string {
  return value.length <= 8 ? "••••" : `••••••${value.slice(-4)}`;
}

export interface SecretStatus {
  set: boolean;
  masked: string | null;
  source: "settings" | "environment" | null;
}

/** What Settings may show about each secret. */
export async function secretStatus(): Promise<Record<SecretName, SecretStatus>> {
  const file = await readSecretsFile();
  return Object.fromEntries(
    SECRET_NAMES.map((name) => {
      const fromFile = file[name];
      const fromEnv = process.env[ENV_FALLBACK[name]];
      const value = fromFile ?? fromEnv;
      return [
        name,
        {
          set: Boolean(value),
          masked: value ? maskSecret(value) : null,
          source: fromFile ? "settings" : fromEnv ? "environment" : null,
        },
      ];
    }),
  ) as Record<SecretName, SecretStatus>;
}
