#!/usr/bin/env node
// Next.js "standalone" output traces JS statically, but Prisma's query engine
// is a native binary loaded by a runtime-computed path, so the tracer misses
// it (a well-known Next+Prisma gap). This copies the generated .prisma/client
// directory (engine binaries included) into one of the fixed fallback
// locations Prisma's client checks at runtime, so `next start`/the standalone
// server.js finds it without depending on pnpm's hashed store paths.
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
// Resolve from @tcg-vault/db, the package that actually declares @prisma/client
// as a dependency — apps/web only gets it transitively.
const dbPackageDir = join(webRoot, "../../packages/db");
const require = createRequire(join(dbPackageDir, "package.json"));

function findGeneratedClientDir() {
  const resolved = require.resolve("@prisma/client/package.json");
  // resolved: .../node_modules/@prisma/client/package.json -> ../../.prisma/client
  return join(dirname(resolved), "../../.prisma/client");
}

const source = findGeneratedClientDir();
if (!existsSync(source)) {
  console.error(`[copy-prisma-engine] generated client not found at ${source}`);
  process.exit(1);
}

const targets = [join(webRoot, ".next/standalone/apps/web/.next/.prisma/client")];

for (const target of targets) {
  cpSync(source, target, { recursive: true });
  console.log(`[copy-prisma-engine] copied ${source} -> ${target}`);
}
