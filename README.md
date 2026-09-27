# TCG Vault

Collection tracker, 3D card viewer and portfolio dashboard for Pokémon, Yu-Gi-Oh! and One Piece cards.

Runs as a native Windows/macOS/Linux desktop app (Tauri) with a local SQLite
database — single profile, no server, no login, no account. See
`apps/desktop/README.md` for how the `.exe`/installer gets built.

## Dev setup
```bash
pnpm i
cp .env.example .env
pnpm db:migrate:dev
pnpm db:seed
pnpm dev
```
Web: http://localhost:3000

## Desktop build
```bash
pnpm --filter @tcg-vault/desktop run package
```
See `apps/desktop/README.md` — a genuine Windows `.exe` needs to be built on
a Windows machine or CI runner (WebView2/NSIS aren't cross-compilable from
Linux/macOS). The repo's `.github/workflows/build-desktop.yml` does this on
`windows-latest` automatically.

## Notes
- All data lives in one SQLite file per install (`DATABASE_URL`), in the
  OS's per-user app-data directory when packaged.
- Card/user images are plain files on disk (`MEDIA_DIR`), served by
  `apps/web/app/media/[...key]/route.ts`.
