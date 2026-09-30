import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@tcg-vault/db";

export const dynamic = "force-dynamic";

/**
 * A consistent backup of the whole database (collection, binders, prices) as
 * one SQLite file. VACUUM INTO writes a clean snapshot even while the app is
 * running, unlike copying the live file.
 */
export async function GET() {
  const dir = await mkdtemp(join(tmpdir(), "tcg-vault-backup-"));
  const file = join(dir, `${randomUUID()}.db`);
  try {
    // The path is generated here (no user input); SQLite needs it as a literal.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const body = await readFile(file);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="tcg-vault-backup-${new Date().toISOString().slice(0, 10)}.db"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
