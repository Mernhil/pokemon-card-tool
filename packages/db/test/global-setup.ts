import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

/** Creates an empty test database by replaying prisma/migrations (as production does); removed afterwards. */
export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tcg-vault-db-test-"));
  const file = join(dir, "test.db");
  process.env.TCG_VAULT_TEST_DIR = dir;
  process.env.DATABASE_URL = `file:${file}`;

  const migrations = join(__dirname, "../prisma/migrations");
  const db = createClient({ url: `file:${file}` });
  for (const name of readdirSync(migrations, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    await db.executeMultiple(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  }
  db.close();
  return () => rmSync(dir, { recursive: true, force: true });
}
