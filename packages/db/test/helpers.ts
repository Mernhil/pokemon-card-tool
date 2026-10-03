import { prisma } from "../src/client";

/**
 * Empties every table. One transaction (so one connection) with foreign keys
 * deferred to commit: a plain `PRAGMA foreign_keys = OFF` only reaches the
 * connection it ran on, and the DELETEs could land on another one.
 */
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
  );
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("PRAGMA defer_foreign_keys = ON");
      for (const { name } of tables) await tx.$executeRawUnsafe(`DELETE FROM "${name}"`);
    },
    { timeout: 30_000 },
  );
}

/** A controllable clock: starts at `start`, moves only when told. */
export function fakeClock(start = new Date("2026-09-01T00:00:00Z")) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}
