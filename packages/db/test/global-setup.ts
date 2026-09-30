import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Creates an empty test database from the current schema; removed afterwards. */
export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tcg-vault-db-test-"));
  const url = `file:${join(dir, "test.db")}`;
  process.env.TCG_VAULT_TEST_DIR = dir;
  process.env.DATABASE_URL = url;
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    // npx is npx.cmd on Windows, which execFile can only start through a shell.
    shell: process.platform === "win32",
  });
  return () => rmSync(dir, { recursive: true, force: true });
}
