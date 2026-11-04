# TCG Vault on Cloudflare (iPhone, Add to Home Screen)

The same Next.js app, built for Cloudflare Workers: **D1** holds the database, **R2** the card
scans and your own photos, a **cron trigger** runs the catalog / price / FX sync, and
**Cloudflare Access** puts a login in front. On the phone you open the site in Safari and use
*Share → Add to Home Screen*; it launches full screen like an app.

The desktop app is unchanged and keeps its own local database. The hosted app has its own copy
(see "Moving your collection over").

## What you need
- A Cloudflare account on the **Workers Paid plan** (about $5/month). The free plan's limits (50
  subrequests and 10 ms CPU per invocation) are far too small for syncing.
- Node 22, pnpm 9 (`pnpm install`, then `pnpm db:generate`).
- Building on Linux or macOS is the supported path for OpenNext. Windows builds and runs
  (that is how this was developed), but OpenNext warns it is not fully supported; CI builds on Linux.

## One-time setup
All commands run in `apps/web`.

```bash
npx wrangler login
npx wrangler d1 create tcg-vault            # copy the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create tcg-vault-media
npx wrangler secret put CRON_SECRET         # any long random string
# Optional price sources (same keys as the desktop Settings page):
npx wrangler secret put CARDTRADER_API_TOKEN
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
```

## Deploy
```bash
pnpm cf:deploy                                   # builds with CF_BUILD=1 and deploys
npx wrangler d1 migrations apply DB --remote     # needs `pnpm cf:migrations` first (flattens Prisma's folders)
```
or run the **Deploy to Cloudflare** GitHub workflow (needs the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets).

Local test with an emulated D1/R2: `pnpm cf:preview` (put `CRON_SECRET="x"` in `apps/web/.dev.vars`).

## Put a login in front (Cloudflare Access)
The Worker itself has no login. In the Cloudflare dashboard: **Zero Trust → Access →
Applications → Add → Self-hosted**, pick the Worker's hostname (enable a custom domain or the
`workers.dev` route for the Worker first), and add a policy *Allow → Emails → your address*.
Cloudflare then emails a one-time code before anything loads. Do this **before** you open the
URL for real: until then the site (and your collection) is public.

The cron trigger calls the app internally, not through that hostname, so Access does not block it.
`/api/cron/tick` additionally requires the `CRON_SECRET` header.

## Moving your collection over
Hosted data is separate from the desktop's. To copy the desktop's database up:
1. Desktop app: **Settings → Back up** (saves a `.db` file).
2. `node scripts/dump-sqlite.mjs backup.db import.sql`
3. `npx wrangler d1 execute DB --remote --file import.sql`

Rows keep their ids, so your collection, binders, wishlist and alerts keep pointing at the right
cards. (Without this, the cloud simply syncs the catalog fresh and you start an empty collection.)
Back up the hosted database any time with `npx wrangler d1 export tcg-vault --remote --output backup.sql`.

## How syncing works here
Every 5 minutes the cron trigger runs `lib/cloud-tick.ts`: a few stale/new sets per game, a slice of
stale prices per provider, today's ECB rates, then valuations and a portfolio snapshot. It stops after
about 3 minutes and the job runner's per-item state resumes it on the next tick, so a fresh database
fills in over a few hours. The Sync page buttons still work (they run inside the request / `waitUntil`).

## Differences from the desktop app
- **Not atomic.** D1 has no interactive transactions, so those code paths run as plain sequential
  queries. Sync writes are idempotent upserts and an item only counts as done when it finishes.
- **100 bound parameters per query** on D1. Long `in: [...]` lists go through `inChunks`
  (`packages/db/src/chunk.ts`); new code that filters by a long list must do the same.
- **API keys** are Worker secrets (`wrangler secret put`), not typed into Settings.
- **Backup** is `wrangler d1 export`, not the Settings button.
- **Images** are fetched from the sources on first view and kept in R2 (no 500 MB cap enforcement
  beyond what the eviction code does; R2 storage is cheap, so this is fine for one user).
- The `/binders` editor and other desktop-sized screens were not reworked for phones.

## How the build is wired
- `next.config.mjs` (`CF_BUILD=1`): swaps `packages/db/src/client.ts` → `client.workers.ts` (D1), the
  generated Prisma client `generated/node` → `generated/workerd`, and
  `packages/shared/src/local-storage.ts` → `local-storage.workers.ts` (R2); marks the Prisma wasm
  query compiler external; inlines `TCG_VAULT_CLOUD=1` (no in-process scheduler, no startup backfills).
- Prisma 7 needs a driver adapter everywhere: libsql on Node (desktop, dev, tests), D1 on Workers.
  The generated clients are git-ignored; `pnpm db:generate` (also run on install) creates both.
- `worker.ts` is the Worker entry: the OpenNext handler plus the `scheduled` cron handler.
