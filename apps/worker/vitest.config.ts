import { defineConfig } from "vitest/config";

// No job logic is implemented yet (see src/jobs/*.ts TODOs) — nothing to unit-test until then.
export default defineConfig({
  test: { passWithNoTests: true },
});
