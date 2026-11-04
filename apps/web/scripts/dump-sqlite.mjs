#!/usr/bin/env node
// Converts a desktop backup (Settings > Back up, a SQLite file) into a SQL file for D1:
//   node scripts/dump-sqlite.mjs <backup.db> [out.sql]
//   wrangler d1 execute DB --remote --file out.sql
// Rows keep their ids, so your collection, binders and alerts still point at the right
// cards; later cloud syncs update the same rows by their natural keys. Tables that only make
// sense on the machine that wrote them (job locks, the on-disk image cache index) are skipped.
import { createClient } from "@libsql/client";
import { createWriteStream } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [source, target = "d1-import.sql"] = process.argv.slice(2);
if (!source) {
  console.error("usage: node scripts/dump-sqlite.mjs <backup.db> [out.sql]");
  process.exit(1);
}
const SKIP = new Set(["JobLock", "ImageCacheEntry", "_local_migrations", "_prisma_migrations"]);

const db = createClient({ url: pathToFileURL(resolve(source)).href });
const out = createWriteStream(target);
const write = (line) => out.write(`${line}\n`);

const literal = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof ArrayBuffer) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
};

const tables = (
  await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
).rows
  .map((row) => String(row.name))
  .filter((name) => !SKIP.has(name));

// D1 enforces foreign keys; check them at the end of the file instead of per row.
write("PRAGMA defer_foreign_keys = on;");
let total = 0;
for (const table of tables) {
  const result = await db.execute(`SELECT * FROM "${table}"`);
  const columns = result.columns.map((c) => `"${c}"`).join(", ");
  write(`DELETE FROM "${table}";`);
  // Multi-row inserts stay under D1's statement size and 100-bound-parameter limits (literals, not binds).
  for (let i = 0; i < result.rows.length; i += 50) {
    const rows = result.rows
      .slice(i, i + 50)
      .map((row) => `(${result.columns.map((_, c) => literal(row[c])).join(", ")})`)
      .join(",\n");
    write(`INSERT INTO "${table}" (${columns}) VALUES\n${rows};`);
  }
  total += result.rows.length;
  console.log(`${table}: ${result.rows.length} rows`);
}
out.end();
console.log(`wrote ${total} rows to ${target}`);
