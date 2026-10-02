#!/usr/bin/env node
// `wrangler d1 migrations` wants flat <name>.sql files; Prisma keeps
// prisma/migrations/<name>/migration.sql. Flatten them (generated, gitignored).
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../../packages/db/prisma/migrations");
const target = join(here, "../.d1-migrations");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  cpSync(join(source, entry.name, "migration.sql"), join(target, `${entry.name}.sql`));
}
console.log(`[d1-migrations] wrote ${readdirSync(target).length} migrations to ${target}`);
