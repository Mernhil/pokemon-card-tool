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

const SPLASH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TCG Vault</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #171717; background: #fff;
  }
  h1 { font-size: 28px; margin: 0; }
  #status { color: #737373; font-size: 14px; }
  #error { display: none; max-width: 560px; padding: 12px 16px; border: 1px solid #fecaca;
    background: #fef2f2; color: #991b1b; border-radius: 8px; font-size: 14px; white-space: pre-wrap; }
  .spinner { width: 22px; height: 22px; border: 3px solid #e5e5e5; border-top-color: #171717;
    border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <h1>TCG Vault</h1>
  <div class="spinner" id="spinner"></div>
  <p id="status">Starting…</p>
  <p id="error"></p>
  <script>
    window.showStartupError = function (message) {
      document.getElementById("spinner").style.display = "none";
      document.getElementById("status").textContent = "TCG Vault couldn't start.";
      var el = document.getElementById("error");
      el.textContent = message;
      el.style.display = "block";
    };
  </script>
</body>
</html>
`;

// tauri.conf.json's `build.frontendDist`: the window opens on this local
// splash while the bundled server boots, then src-tauri/src/main.rs
// navigates it to the server. main.rs calls `showStartupError(message)` if
// the server fails to start, so the user never gets a blank window.
const frontendDistDir = join(desktopRoot, "dist");
mkdirSync(frontendDistDir, { recursive: true });
writeFileSync(join(frontendDistDir, "index.html"), SPLASH_HTML);

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
