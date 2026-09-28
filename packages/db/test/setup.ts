import { join } from "node:path";

// Inherited from global-setup.ts; set again in case the worker was spawned
// with a copy of the environment from before it ran.
const dir = process.env.TCG_VAULT_TEST_DIR;
if (!dir) throw new Error("test/global-setup.ts didn't run");
process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
process.env.MEDIA_DIR = join(dir, "media");
process.env.TCG_VAULT_DATA_DIR = join(dir, "data");
