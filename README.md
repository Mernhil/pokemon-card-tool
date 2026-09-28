# TCG Vault

Collection tracker, 3D card viewer and portfolio dashboard for Pokémon, Yu-Gi-Oh! and One Piece cards.

Runs as a native Windows/macOS/Linux desktop app (Tauri) with a local SQLite
database — single profile, no server, no login, no account. See
`apps/desktop/README.md` for how the `.exe`/installer gets built.

## What's in it
- **Browse & Search** the synced catalog: sets by series with logos and your
  completion, card grids with owned/missing filters, prices per finish.
- **Card page:** a 3D card you can tilt, inspect full-screen, rotate and zoom,
  with holo / reverse-holo / full-art foil; prices from Cardmarket, TCGplayer,
  CardTrader and eBay side by side (each labelled Sold / Asking / Market avg /
  Trend / Lowest listing), best value, condition estimate, price history
  chart; one-click add.
- **Collection:** grid or list, filters, quantity/condition edits in place,
  value and profit/loss.
- **Binders:** a shelf of leather binders; open one to turn real 3D pages
  (drag the corner), drag cards from "Your cards" into pockets, move/swap
  them, or build a binder from a set with the missing cards greyed out.
- **Dashboard:** collection value over time, top movers, value by set and
  rarity, set completion, top cards.
- **Sync:** every set syncs by itself in the background (card data only;
  images download when first viewed and are cached, max 500 MB). Pick sets to
  sync them first. **Settings:** price-source keys, display currency, refresh
  cadence. Light / dark / auto theme; updates install from inside the app.

**Setting up price sources, keys, and a fresh machine: see
[docs/setup.md](docs/setup.md).**

## Dev setup
```bash
pnpm i
cp .env.example .env
pnpm db:migrate:dev
pnpm db:seed
pnpm dev            # starts syncing every set in the background after ~10 s
pnpm db:seed-demo   # optional: a sample card with made-up prices, no network needed
```
Web: http://localhost:3000

## Getting cards and prices in
- **Catalog:** [TCGdex](https://tcgdex.dev) (Pokémon, English), synced set by
  set in the background, newest first, resumable (`packages/db/src/catalog-sync.ts`
  on the shared job runner in `packages/db/src/jobs`). One failing set never
  blocks the others; failed sets are retried on the next run. CLI:
  `pnpm db:sync-catalog -- --all | --sets <codes> | --retry-failed | --status`.
- **Prices:** one background job per provider (`packages/db/src/price-refresh.ts`,
  adapters in `packages/sources/src/pricing`): cards in your collection every
  24 h, then recently viewed cards; any other card when you open it. Card
  pages only read stored prices. CLI: `pnpm db:sync-prices`.
- A card's value is the near-mint price combined across providers
  (`packages/db/src/valuations.ts`), scaled by condition in your collection.

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
