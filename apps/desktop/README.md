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
- On launch, `src-tauri/src/main.rs` shows a local "Starting…" splash
  (`dist/index.html`, written by `prepare-resources`), picks a free port,
  spawns the sidecar on it pointed at `DATABASE_URL`/`MEDIA_DIR` inside the
  app-data directory, and navigates the window to it once it accepts
  connections. If the server dies first, the splash shows an error pointing
  at `<app data>/server.log`, which holds the server's output for that launch.
  `TCG_VAULT_DESKTOP=1` tells the Next.js server
  (`apps/web/instrumentation.ts`) to replay any un-applied SQL migrations by
  hand on first launch, since there's no `prisma` CLI bundled.
- The server must never outlive the app: Windows doesn't kill child
  processes with their parent, and an orphaned server from an older version
  used to keep answering with pages whose JS chunks had been replaced by the
  update ("Application error: a client-side exception has occurred"), and
  block the installer from overwriting `node.exe`. So: the shell kills it on
  exit and before the updater installs; the server exits by itself when the
  shell's PID disappears (`apps/web/lib/parent-watchdog.ts`); and the NSIS
  pre-install hook (`src-tauri/windows/installer-hooks.nsh`) stops any
  `node.exe` still running from the install directory.

## Why the `.exe` isn't built here

Producing a real Windows installer needs the Windows MSVC toolchain,
WebView2, and NSIS — none of which exist (or reliably cross-compile) on
Linux/macOS. `.github/workflows/build-desktop.yml` builds it on a
`windows-latest` GitHub Actions runner instead:

```bash
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
# or: gh workflow run build-desktop.yml
```

The workflow also code-signs the build (Tauri's own updater signing, not a
Windows Authenticode cert) and publishes a GitHub Release for the pushed tag
with the installer, its `.sig` signature, and a hand-assembled `latest.json`
manifest — see "Auto-update" below for the one-time setup this needs.

## Auto-update

Built on Tauri's updater plugin (`tauri-plugin-updater`), with GitHub
Releases as the update server — no separate service.

How it behaves (`src-tauri/src/updater.rs`):

1. 5 s after launch, and then every 6 hours while the app is open, it
   fetches `plugins.updater.endpoints` in `tauri.conf.json` (this repo's
   "latest release" `latest.json`).
2. If that version is newer, it **downloads the installer in the background
   and verifies its signature** against `plugins.updater.pubkey`. A download
   that doesn't match the signature is discarded.
3. Only then does the user hear about it: an "Update ready" card in the app
   (`apps/web/components/update-banner.tsx`) with **Restart & install** /
   **Later**. "Later" reminds again on the next launch. If the app's pages
   can't load (e.g. the server failed to start), a native dialog asks
   instead, so a broken install can still get its fix.
4. **Restart & install**: on Windows the shell stops the local server and
   hands over to the NSIS installer (passive mode), which replaces the app
   and starts it again; on macOS/Linux it's replaced in place and restarted.

The web page talks to the shell through two app commands,
`update_status` and `install_update`, which `capabilities/local-app-updater.json`
exposes to the local server's origin (`http://127.0.0.1:*`) — nothing else
from Tauri is reachable from the page.

Tauri 2 updates straight from the signed installer (`.exe` + `.exe.sig`,
produced because `bundle.createUpdaterArtifacts` is `true`); the `.tar.gz`
/ `.zip` bundles were Tauri 1's format and aren't needed.

To publish an update:

1. Bump the version in `src-tauri/tauri.conf.json` (the one the build and
   the updater use), and keep `src-tauri/Cargo.toml`, `Cargo.lock` and
   `package.json` in step.
2. Commit, then `git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`
   on that commit. CI refuses to build if the tag and `tauri.conf.json`
   disagree.
3. CI builds, signs, and publishes the release automatically. Anyone
   running an older signed build gets prompted next time they open the app.

**One-time setup (already done once for this repo, only needed again if the
signing key is ever rotated):** the updater only trusts builds signed with
one specific keypair. The public half is already committed in
`tauri.conf.json` (`plugins.updater.pubkey`). The private half must be
added as two **repository secrets** (Settings → Secrets and variables →
Actions) so CI can sign releases:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (blank/empty value — this key has no
  password)

Generate a new keypair (only if starting fresh or rotating) with:

```bash
pnpm --filter @tcg-vault/desktop exec tauri signer generate -w /path/to/keep/private.key
```

Never commit the private key file. Only the `.pub` file's contents go into
`tauri.conf.json`.

### Testing auto-update locally

Debug builds (never release builds) read two overrides, so the whole flow
can be tried without publishing anything:

```bash
# a throwaway keypair and a fake, newer "release"
pnpm --filter @tcg-vault/desktop exec tauri signer generate --ci -p "" -w /tmp/upd/test.key
cp path/to/some/installer-or-binary /tmp/upd/TCG-Vault_9.9.9_x64-setup.exe
pnpm --filter @tcg-vault/desktop exec tauri signer sign -f /tmp/upd/test.key -p "" /tmp/upd/TCG-Vault_9.9.9_x64-setup.exe
# write /tmp/upd/latest.json: {"version":"9.9.9","platforms":{"windows-x86_64":
#   {"url":"http://127.0.0.1:8765/TCG-Vault_9.9.9_x64-setup.exe","signature":"<contents of the .sig>"}}}
# (use "linux-x86_64" / "darwin-aarch64" etc. on those platforms)
python -m http.server 8765 --directory /tmp/upd

# then run a debug build pointed at it
TCG_VAULT_UPDATE_ENDPOINT=http://127.0.0.1:8765/latest.json \
TCG_VAULT_UPDATE_PUBKEY="$(cat /tmp/upd/test.key.pub)" \
  apps/desktop/src-tauri/target/debug/tcg-vault-desktop
```

The "Update ready" card appears once the download has been verified.
Signing the file with a different key (or serving a different file) must
make it log `signature verification failed` and offer nothing.

## Building locally (on an actual Windows machine)

```bash
pnpm install
pnpm --filter @tcg-vault/db run generate
pnpm --filter @tcg-vault/web run build
# Download a portable node.exe yourself and place it at:
#   apps/desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe
pnpm --filter @tcg-vault/desktop run package
```
