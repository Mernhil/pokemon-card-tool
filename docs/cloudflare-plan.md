# Hosted web app on Cloudflare (iPhone, Add to Home Screen)

Status: groundwork only. Decisions: single user, cloud copy of the data, Cloudflare Access for login.

## Done
- PWA: `apps/web/app/manifest.ts`, icons, Apple web-app meta, phone layout (`components/mobile-nav.tsx`).
- Next 15.5 / React 19 (the Cloudflare adapter `@opennextjs/cloudflare` needs >= 15.5.26).

## To do (in order)
1. OpenNext + `wrangler.jsonc`; run with `wrangler dev` (local D1/R2 emulation).
2. Database: Prisma -> D1. Open decision: stay on Prisma 5 (`@prisma/adapter-d1` 5.x, driverAdapters preview,
   wasm engine) or move to Prisma 7 (no Rust engine, easier on Workers). Replace `lib/migrate.ts` with D1 migrations;
   `enableConcurrentReads` and the raw SQL in `base-data.ts` / `dex.ts` need review.
3. Images: `packages/db/src/image-cache.ts` and `app/media` use the filesystem -> R2.
4. Sync: `lib/background.ts`, `lib/scheduler.ts`, `packages/db/src/jobs` run in-process with a DB lock.
   Workers need Cron Triggers running small resumable batches (subrequest and CPU limits).
5. Cloudflare Access in front of the Worker (email login); no auth code in the app.
6. One-time import of the desktop collection into D1 (the desktop app already has an export route).

## Needs the owner
`wrangler login`, creating the D1 database and R2 bucket, the Access policy.
