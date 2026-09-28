import { defineConfig } from "vitest/config";

// Tests run against a real, throwaway SQLite file (created in
// test/global-setup.ts from the Prisma schema): the job runner's guarantees
// (locks, transactions, resumability) are about what's actually in the DB.
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // One database file, so test files must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
