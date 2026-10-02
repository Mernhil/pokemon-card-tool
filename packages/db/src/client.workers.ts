// Cloudflare Workers build of ./client.ts (swapped in by apps/web/next.config.mjs
// when building for Cloudflare). Same `prisma` export, backed by D1.
import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient, type Prisma } from "./generated/workerd/client";

const clients = new WeakMap<object, PrismaClient>();
let override: D1Database | undefined;

/** For code that runs outside a Next.js request (the cron handler): use this D1 binding. */
export function useDatabase(db: D1Database): void {
  override = db;
}

function current(): PrismaClient {
  const db = override ?? (getCloudflareContext().env as { DB: D1Database }).DB;
  let client = clients.get(db);
  if (!client) {
    client = new PrismaClient({ adapter: new PrismaD1(db) });
    clients.set(db, client);
  }
  return client;
}

/** Resolved per request: a Worker's bindings only exist while handling one. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = current();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * D1 has no interactive transactions (Prisma refuses them), so the callback runs
 * as plain sequential queries. Not atomic: callers must be safe to re-run after a
 * partial failure (the sync jobs are: they upsert, and an item only counts as
 * done once it returns).
 */
export function interactiveTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  _options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  return fn(prisma as unknown as Prisma.TransactionClient);
}
