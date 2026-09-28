# TCG Vault

Collection tracker, 3D card viewer and portfolio dashboard for Pokémon, Yu-Gi-Oh! and One Piece cards.

Runs as a native Windows/macOS/Linux desktop app (Tauri) with a local SQLite
database — single profile, no server, no login, no account. See
`apps/desktop/README.md` for how the `.exe`/installer gets built.

## What's in it
- **Browse & Search** the synced catalog: sets by series with logos and your
  completion, card grids with owned/missing filters, prices per finish.
- **Card page:** a 3D card you can tilt, inspect full-screen, rotate and zoom,
  with holo / reverse-holo / full-art foil; price history; one-click add.
- **Collection:** grid or list, filters, quantity/condition edits in place,
  value and profit/loss.
- **Binders:** a shelf of leather binders; open one to turn real 3D pages
  (drag the corner), drag cards from "Your cards" into pockets, move/swap
  them, or build a binder from a set with the missing cards greyed out.
- **Dashboard:** collection value over time, value by set and rarity, set
  completion, top cards.
- **Sync:** pick sets, watch them download with live progress; prices refresh
  nightly. Light / dark / auto theme; updates install from inside the app.

## Dev setup
```bash
pnpm i
cp .env.example .env
pnpm db:migrate:dev
pnpm db:seed
pnpm db:sync-catalog -- --sets sv06.5,sv03.5   # or use the Sync page in the app
pnpm dev
```
Web: http://localhost:3000

## Getting cards and prices in
Everything comes from [TCGdex](https://tcgdex.dev) (Pokémon, English): card
data, images, and the Cardmarket (EUR) + TCGplayer (USD) prices it bundles
with each card. Needs internet.

- **In the app:** the **Sync** page lists every set; tick some and press
  *Sync selected sets*. *Refresh prices* re-syncs the sets you already have.
- **CLI:** `pnpm db:sync-catalog -- --sets <codes>`, or
  `pnpm db:sync-prices` to refresh every synced set.
- The app also refreshes prices nightly at 03:30 while it's running.

Re-syncing is safe: images already on disk aren't downloaded again, and each
run appends new price observations. A card's value is the near-mint price
combined from both sources (`packages/db/src/valuations.ts`), scaled by
condition in your collection.

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
