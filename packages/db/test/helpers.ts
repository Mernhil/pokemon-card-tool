import { prisma } from "../src/client";

/** Empties every table, children first. */
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
  );
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const { name } of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${name}"`);
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
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
