# TCG Vault

Collection tracker, 3D card viewer and portfolio dashboard for Pokémon, Yu-Gi-Oh! and One Piece cards.

## Setup

```bash
pnpm i
supabase start                 # local Postgres + Auth + Storage (auth.uid()/RLS need this, not plain Postgres)
docker compose up -d           # Meilisearch, Redis, MinIO (local R2), imgproxy
cp .env.example .env           # then fill SUPABASE_*_KEY from the `supabase start` output
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Web app: http://localhost:3000 · Supabase Studio: http://localhost:54323 · Meilisearch: http://localhost:7700

## Notes

- Prisma connects with a role that **bypasses Row Level Security**. Every server action/query must
  filter by the current session's `userId` itself — RLS is a last-resort backstop, not the access
  control layer for Prisma-issued queries.
- `supabase stop` shuts the local stack down; `supabase stop --no-backup` also wipes its volume.
