import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/client";

describe("database backup", () => {
  it("VACUUM INTO writes a snapshot file through Prisma", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    const file = join(dir, "snap.db");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${file}'`);
    expect((await stat(file)).size).toBeGreaterThan(0);
  });
});
