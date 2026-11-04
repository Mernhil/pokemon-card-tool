import { defineConfig } from "prisma/config";

// Prisma 7 keeps the connection out of schema.prisma. The CLI (migrate,
// db push) connects to this file; the app connects through a driver adapter
// (src/client.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "file:./prisma/local.db" },
});
