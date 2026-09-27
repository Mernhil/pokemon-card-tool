import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@tcg-vault/db";

/**
 * Only used in the packaged desktop app (see instrumentation.ts): there's no
 * `prisma` CLI or schema-engine binary bundled, so on first launch against a
 * fresh per-user SQLite file, this replays packages/db/prisma/migrations/*
 * by hand via the already-generated Prisma Client. Regular dev/CI use
 * `pnpm db:migrate:dev` / `db:migrate:deploy` instead — this is not that.
 */
const migrationsDir =
  process.env.MIGRATIONS_DIR ?? join(process.cwd(), "../../packages/db/prisma/migrations");

export async function runMigrations(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS _local_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );

  let names: string[];
  try {
    names = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    console.warn(`[migrate] no migrations directory found at ${migrationsDir}`);
    return;
  }

  for (const name of names) {
    const applied = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM _local_migrations WHERE id = ?`,
      name,
    );
    if (applied.length > 0) continue;

    const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    const statements = sql
      .split(/;\s*[\r\n]+/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO _local_migrations (id, applied_at) VALUES (?, ?)`,
      name,
      new Date().toISOString(),
    );
    console.log(`[migrate] applied ${name}`);
  }
}
