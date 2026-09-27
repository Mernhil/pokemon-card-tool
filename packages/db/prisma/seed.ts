import { ensureBaseData, prisma } from "../src";

/** Minimal local dev seed: games + languages. The catalog itself comes from sync-catalog. */
ensureBaseData()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
