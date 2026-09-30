"use client";

import type { AppSettings, SecretStatus } from "@tcg-vault/db";
import {
  PRICE_KIND_LABELS,
  PRICE_LANGUAGES,
  type PriceKind,
} from "@tcg-vault/shared/src/enums";
import { CheckCircle2, CircleAlert, KeyRound, PlugZap, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckForUpdatesButton } from "../../components/check-for-updates-button";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/ui/toast";
import {
  refreshAllPricesAction,
  saveSecretAction,
  saveSettingsAction,
  testConnectionAction,
} from "./actions";

export interface ProviderView {
  id: string;
  label: string;
  note: string;
  enabled: boolean;
  configured: boolean;
  needsCredentials: boolean;
  kinds: PriceKind[];
  rateLimit: string;
  secrets: Array<{ name: string; label: string } & SecretStatus>;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  rateLimitedUntil: number | null;
}

const when = (t: number) => new Date(t).toLocaleString();
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function SecretField({ secret }: { secret: ProviderView["secrets"][number] }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const save = (next: string) =>
    start(async () => {
      const result = await saveSecretAction(secret.name, next);
      if (result.ok) {
        setValue("");
        toast("success", next ? `${secret.label} saved` : `${secret.label} removed`);
        router.refresh();
      } else toast("error", result.error);
    });

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-700" htmlFor={secret.name}>
        {secret.label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={secret.name}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="field min-w-0 flex-1 font-mono text-xs"
          placeholder={secret.set ? `Saved (${secret.masked}) — paste to replace` : "Paste it here"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" disabled={pending || !value.trim()} onClick={() => save(value.trim())}>
          Save
        </Button>
        {secret.set && secret.source === "settings" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => save("")}>
            Remove
          </Button>
        ) : null}
      </div>
      {secret.set ? (
        <p className="text-[11px] text-neutral-500">
          <KeyRound className="mr-1 inline h-3 w-3" />
          {secret.masked} ·{" "}
          {secret.source === "environment"
            ? "from an environment variable"
            : "saved on this computer"}
        </p>
      ) : null}
    </div>
  );
}

function ProviderCard({
  provider,
  settings,
  marketplaces,
  onSave,
}: {
  provider: ProviderView;
  settings: AppSettings;
  marketplaces: string[];
  onSave: (patch: Partial<AppSettings>) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testConnectionAction(provider.id));
    } finally {
      setTesting(false);
    }
  };

  return (
    <article className="rounded-xl border p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{provider.label}</h3>
          <p className="mt-1 max-w-xl text-xs text-neutral-500">{provider.note}</p>
          <p className="mt-1 text-[11px] text-neutral-400">
            Reports: {provider.kinds.map((k) => PRICE_KIND_LABELS[k]).join(", ")} ·{" "}
            {provider.rateLimit}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(e) =>
              onSave({
                providers: {
                  ...settings.providers,
                  [provider.id]: { enabled: e.target.checked },
                } as AppSettings["providers"],
              })
            }
            className="accent-[rgb(var(--accent))]"
          />
          Enabled
        </label>
      </header>

      {provider.secrets.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {provider.secrets.map((s) => (
            <SecretField key={s.name} secret={s} />
          ))}
        </div>
      ) : null}

      {provider.id === "ebay" ? (
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <label className="flex items-center gap-2">
            Marketplace
            <select
              className="field py-1 text-xs"
              value={settings.ebay.marketplaceId}
              onChange={(e) =>
                onSave({ ebay: { ...settings.ebay, marketplaceId: e.target.value } })
              }
            >
              {marketplaces.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Keys are for
            <select
              className="field py-1 text-xs"
              value={settings.ebay.environment}
              onChange={(e) =>
                onSave({
                  ebay: {
                    ...settings.ebay,
                    environment: e.target.value as "production" | "sandbox",
                  },
                })
              }
            >
              <option value="production">Production (real listings)</option>
              <option value="sandbox">Sandbox (test data only)</option>
            </select>
          </label>
        </div>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs">
        <div className="flex flex-col gap-0.5 text-neutral-500">
          {provider.needsCredentials && !provider.configured ? (
            <span className="text-amber-700 dark:text-amber-300">API key not set</span>
          ) : null}
          {provider.rateLimitedUntil ? (
            <span className="text-amber-700 dark:text-amber-300">
              Rate limited until {when(provider.rateLimitedUntil)}
            </span>
          ) : null}
          <span>
            Last success: {provider.lastSuccessAt ? when(provider.lastSuccessAt) : "never"}
          </span>
          {provider.lastError && provider.lastErrorAt ? (
            <span className="text-red-700 dark:text-red-300">
              Last error ({when(provider.lastErrorAt)}): {provider.lastError}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {result ? (
            <span
              className={`flex items-center gap-1 ${result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
              aria-live="polite"
            >
              {result.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <CircleAlert className="h-3.5 w-3.5" />
              )}
              {result.message}
            </span>
          ) : null}
          <Button size="sm" variant="secondary" disabled={testing} onClick={test}>
            <PlugZap className="h-3.5 w-3.5" /> {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
      </footer>
    </article>
  );
}

export function SettingsForm({
  settings,
  providers,
  currencies,
  rates,
  marketplaces,
  storage,
}: {
  settings: AppSettings;
  providers: ProviderView[];
  currencies: string[];
  rates: { source: string; asOf: string | null };
  marketplaces: string[];
  storage: {
    secretsFile: string;
    cacheDir: string;
    cacheBytes: number;
    cacheFiles: number;
    pinnedBytes: number;
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const save = (patch: Partial<AppSettings>) =>
    start(async () => {
      const result = await saveSettingsAction(patch);
      if (result.ok) {
        toast("success", "Settings saved");
        router.refresh();
      } else toast("error", result.error);
    });
  const number = (key: keyof AppSettings, min: number, max: number) => ({
    type: "number" as const,
    min,
    max,
    defaultValue: settings[key] as number,
    className: "field w-24 py-1 text-sm",
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (v !== settings[key]) save({ [key]: v } as Partial<AppSettings>);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Price sources</h2>
            <p className="text-xs text-neutral-500">
              Keys are stored only on this computer ({storage.secretsFile}), never shown again in
              full, never logged.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await refreshAllPricesAction();
              toast("success", "Refreshing prices in the background");
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh prices
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              settings={settings}
              marketplaces={marketplaces}
              onSave={save}
            />
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Display</h2>
        <label className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          Currency
          <select
            className="field py-1 text-sm"
            value={settings.displayCurrency}
            onChange={(e) => save({ displayCurrency: e.target.value })}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          Price language
          <select
            className="field py-1 text-sm"
            value={settings.priceLanguage}
            onChange={(e) => save({ priceLanguage: e.target.value as AppSettings["priceLanguage"] })}
          >
            {PRICE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          Values and prices everywhere use listings in this language, so cheap copies in other
          languages don&apos;t pull them down. CardTrader and eBay can be split by language;
          Cardmarket and TCGplayer numbers (via TCGdex) can&apos;t, and are always labelled &quot;all
          languages&quot;. Changing it recomputes your values.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.showPocketSets}
            onChange={(e) => save({ showPocketSets: e.target.checked })}
          />
          Show digital-only (Pokémon TCG Pocket) sets
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          Off hides that whole section from Browse. Pocket sets are still synced; they have no
          market prices, so their prices are never refreshed.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Prices are stored in the currency they were quoted in and converted only for display
          (shown with ≈), using{" "}
          {rates.source === "ecb"
            ? `European Central Bank reference rates of ${rates.asOf}`
            : "built-in approximate rates until the daily European Central Bank rates have been fetched"}
          .
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Refresh cadence</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3">
            Collection prices every (hours)
            <input {...number("priceRefreshHours", 1, 720)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            Card page refreshes prices older than (hours)
            <input {...number("staleAfterHours", 1, 720)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            Re-sync card data of a set every (days)
            <input {...number("catalogRefreshDays", 1, 365)} />
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Only cards in your collection and cards you&apos;ve looked at recently are priced
          automatically; any other card is priced when you open it.
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Image cache</h2>
        <label className="mt-3 flex items-center gap-3 text-sm">
          Maximum size (MB)
          <input {...number("imageCacheMaxMb", 50, 100000)} />
        </label>
        <p className="mt-2 text-xs text-neutral-500">
          {storage.cacheFiles} card images, {mb(storage.cacheBytes)} ({mb(storage.pinnedBytes)} for
          cards in your collection, which are never removed). Least recently viewed images are
          removed first. Stored in {storage.cacheDir}.
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Software update</h2>
        <p className="mt-2 text-xs text-neutral-500">
          TCG Vault checks for a new version automatically every few hours. Use this to check right
          now instead of waiting. Does nothing in a browser — only the desktop app.
        </p>
        <div className="mt-3">
          <CheckForUpdatesButton />
        </div>
      </section>
    </div>
  );
}
