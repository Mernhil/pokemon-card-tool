import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "./generated/node/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * `DATABASE_URL` is `file:<path>`. Prisma 5 resolved a relative path against
 * the schema directory; keep that so the existing `.env` (`file:./local.db`) works,
 * from the repo root, apps/web or packages/db alike.
 */
function schemaDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++, dir = resolve(dir, "..")) {
    const candidate = join(dir, "packages/db/prisma");
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, "prisma/schema.prisma"))) return join(dir, "prisma");
  }
  return process.cwd();
}

function sqlitePath(): string {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) throw new Error("DATABASE_URL must be a file: URL");
  const path = url.slice("file:".length).split("?")[0]!;
  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path)) return path;
  return resolve(schemaDir(), path);
}

function create(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaLibSql({ url: pathToFileURL(sqlitePath()).href }) });
}

export const prisma = globalThis.__prisma ?? create();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
