import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import {
  defaultSettings,
  getSettings,
  maskSecret,
  readSecrets,
  sanitizeSettings,
  secretStatus,
  secretsPath,
  updateSettings,
  writeSecret,
} from "../src/settings";
import { resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await rm(secretsPath(), { force: true });
  delete process.env.CARDTRADER_API_TOKEN;
});
afterAll(() => prisma.$disconnect());

describe("settings", () => {
  it("defaults, then persists validated changes", async () => {
    expect(await getSettings()).toEqual(defaultSettings());
    const next = await updateSettings({
      displayCurrency: "usd",
      priceRefreshHours: 6,
      providers: { ebay: { enabled: false } },
    });
    expect(next.displayCurrency).toBe("USD");
    expect(next.priceRefreshHours).toBe(6);
    expect(next.providers.ebay.enabled).toBe(false);
    expect(next.providers.cardtrader.enabled).toBe(true);
    expect(await getSettings()).toEqual(next);
  });

  it("clamps and ignores garbage instead of storing it", () => {
    const s = sanitizeSettings({
      displayCurrency: "not a currency",
      priceRefreshHours: -5,
      imageCacheMaxMb: "lots",
      ebay: { marketplaceId: "EBAY_MARS", environment: "staging" },
    });
    expect(s.displayCurrency).toBe("EUR");
    expect(s.priceRefreshHours).toBe(1);
    expect(s.imageCacheMaxMb).toBe(defaultSettings().imageCacheMaxMb);
    expect(s.ebay).toEqual({ marketplaceId: "EBAY_US", environment: "production" });
  });
});

describe("secrets", () => {
  it("stores keys in an owner-only file, and only ever reports them masked", async () => {
    await writeSecret("cardtraderToken", "  ct-abcdefghijklmnop-1234  ");
    expect((await readSecrets()).cardtraderToken).toBe("ct-abcdefghijklmnop-1234");
    if (process.platform !== "win32") expect((await stat(secretsPath())).mode & 0o777).toBe(0o600);
    const status = await secretStatus();
    expect(status.cardtraderToken).toEqual({ set: true, masked: "••••••1234", source: "settings" });
    expect(JSON.stringify(status)).not.toContain("abcdefgh");
    expect(status.ebayClientId).toEqual({ set: false, masked: null, source: null });
  });

  it("removes a key when saved empty, keeping the others", async () => {
    await writeSecret("ebayClientId", "id-123456789");
    await writeSecret("ebayClientSecret", "secret-123456789");
    await writeSecret("ebayClientId", null);
    expect(JSON.parse(await readFile(secretsPath(), "utf8"))).toEqual({
      ebayClientSecret: "secret-123456789",
    });
  });

  it("falls back to environment variables, and says so", async () => {
    process.env.CARDTRADER_API_TOKEN = "env-token-987654321";
    expect((await readSecrets()).cardtraderToken).toBe("env-token-987654321");
    expect((await secretStatus()).cardtraderToken.source).toBe("environment");
  });

  it("masks short values completely", () => {
    expect(maskSecret("abc")).toBe("••••");
  });

  it("lives in the app data directory, not the repo", () => {
    expect(secretsPath()).toBe(join(process.env.TCG_VAULT_DATA_DIR!, "secrets.json"));
  });
});
