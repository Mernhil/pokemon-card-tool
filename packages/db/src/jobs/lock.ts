import { Prisma } from "../generated/node/client";
import { prisma } from "../client";

/**
 * A mutex stored in the database, so it also holds across processes (the
 * `pnpm db:sync-catalog` CLI and the running app share one SQLite file).
 * The holder refreshes `heartbeatAt`; a lock whose heartbeat is older than
 * `staleMs` belongs to a process that died and may be taken over.
 */
export async function acquireLock(
  name: string,
  holder: string,
  { now = new Date(), staleMs }: { now?: Date; staleMs: number },
): Promise<boolean> {
  try {
    await prisma.jobLock.create({ data: { name, holder, acquiredAt: now, heartbeatAt: now } });
    return true;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  // Taken. One conditional UPDATE, so two processes can't both take over a stale lock.
  const takeover = await prisma.jobLock.updateMany({
    where: { name, heartbeatAt: { lt: new Date(now.getTime() - staleMs) } },
    data: { holder, acquiredAt: now, heartbeatAt: now },
  });
  return takeover.count === 1;
}

export async function heartbeatLock(
  name: string,
  holder: string,
  now = new Date(),
): Promise<boolean> {
  const res = await prisma.jobLock.updateMany({
    where: { name, holder },
    data: { heartbeatAt: now },
  });
  return res.count === 1;
}

export async function releaseLock(name: string, holder: string): Promise<void> {
  await prisma.jobLock.deleteMany({ where: { name, holder } });
}

/** Whether someone currently holds a fresh (non-stale) lock. */
export async function isLocked(name: string, staleMs: number, now = new Date()): Promise<boolean> {
  const row = await prisma.jobLock.findUnique({ where: { name } });
  return !!row && row.heartbeatAt.getTime() >= now.getTime() - staleMs;
}
