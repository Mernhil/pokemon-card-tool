#!/usr/bin/env node
// Assembles the standalone Next.js server + its migration SQL into
// src-tauri/resources/web, which tauri.conf.json's bundle.resources ships
// inside the installer. Run this (via `pnpm build`/`pnpm dev` in this
// package) *after* `pnpm --filter @tcg-vault/web build` has produced
// apps/web/.next/standalone.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const repoRoot = join(desktopRoot, "../..");

const standaloneDir = join(repoRoot, "apps/web/.next/standalone");
const staticDir = join(repoRoot, "apps/web/.next/static");
const migrationsDir = join(repoRoot, "packages/db/prisma/migrations");

const resourcesDir = join(desktopRoot, "src-tauri/resources/web");

// tauri.conf.json's `build.frontendDist` must point at a real, non-empty
// directory at bundle time, but the window never actually shows it — its
// `url` is hardcoded to the sidecar server (see src/main.rs) — so this is
// just a placeholder to satisfy the bundler.
const frontendDistDir = join(desktopRoot, "dist");
mkdirSync(frontendDistDir, { recursive: true });
writeFileSync(
  join(frontendDistDir, "index.html"),
  "<!doctype html><title>TCG Vault</title>\n",
);

if (!existsSync(standaloneDir)) {
  console.error(
    "[prepare-resources] apps/web/.next/standalone not found — run `pnpm --filter @tcg-vault/web build` first.",
  );
  process.exit(1);
}

rmSync(resourcesDir, { recursive: true, force: true });
cpSync(standaloneDir, resourcesDir, { recursive: true });
cpSync(staticDir, join(resourcesDir, "apps/web/.next/static"), { recursive: true });

if (existsSync(migrationsDir)) {
  cpSync(migrationsDir, join(resourcesDir, "packages/db/prisma/migrations"), { recursive: true });
} else {
  console.warn(`[prepare-resources] no migrations directory at ${migrationsDir}`);
}

console.log(`[prepare-resources] wrote ${resourcesDir}`);
