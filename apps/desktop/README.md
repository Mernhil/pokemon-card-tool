# TCG Vault desktop shell

A thin [Tauri](https://tauri.app) window around the same `apps/web` Next.js
app, packaged with a portable Node.js runtime so end users never install
anything but the `.exe`. No cloud, no login: each install gets its own
SQLite database and local media folder under the OS's per-user app-data
directory.

## How it fits together

- `apps/web` builds to `.next/standalone` — a self-contained Node server
  (bundles its own `node_modules`).
- `scripts/prepare-resources.mjs` copies that standalone build, plus
  `packages/db/prisma/migrations`, into `src-tauri/resources/web`. Tauri
  bundles that folder into the installer as a resource.
- `src-tauri/binaries/node-<target-triple>.exe` is a portable Node runtime,
  downloaded at build time (see the CI workflow) — Tauri's sidecar mechanism
  runs `node server.js` from it.
- On launch, `src-tauri/src/main.rs` spawns that sidecar, pointed at
  `DATABASE_URL`/`MEDIA_DIR` inside the app-data directory, waits for it to
  come up on `127.0.0.1:47823`, then shows the window (already pointed at
  that URL). `TCG_VAULT_DESKTOP=1` tells the Next.js server
  (`apps/web/instrumentation.ts`) to replay any un-applied SQL migrations by
  hand on first launch, since there's no `prisma` CLI bundled.

## Why the `.exe` isn't built here

Producing a real Windows installer needs the Windows MSVC toolchain,
WebView2, and NSIS — none of which exist (or reliably cross-compile) on
Linux/macOS. `.github/workflows/build-desktop.yml` builds it on a
`windows-latest` GitHub Actions runner instead:

```bash
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
# or: gh workflow run build-desktop.yml
```

The finished installer is uploaded as the `tcg-vault-windows-installer`
build artifact.

## Building locally (on an actual Windows machine)

```bash
pnpm install
pnpm --filter @tcg-vault/db run generate
pnpm --filter @tcg-vault/web run build
# Download a portable node.exe yourself and place it at:
#   apps/desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe
pnpm --filter @tcg-vault/desktop run package
```
