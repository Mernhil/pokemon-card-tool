# TCG Vault

Collection tracker, 3D card viewer and portfolio dashboard for Pokémon, Yu-Gi-Oh! and One Piece cards.

## Setup
```bash
pnpm i
supabase start        # local Postgres + Auth (auth.uid()/RLS need this, not plain Postgres)
docker compose up -d  # Meilisearch, Redis, MinIO (local R2), imgproxy
cp .env.example .env  # fill SUPABASE_*_KEY from the `supabase start` output
pnpm db:migrate
pnpm db:seed
pnpm dev
```
Web: http://localhost:3000 · Supabase Studio: http://localhost:54323 · Meilisearch: http://localhost:7700

## Notes
- Prisma's role **bypasses RLS**. Every query must filter by the session's `userId` itself.
- `supabase stop --no-backup` also wipes the local stack's data volume.
