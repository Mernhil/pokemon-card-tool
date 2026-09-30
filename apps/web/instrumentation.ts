/** Next.js calls this once, on server start, in the Node runtime only. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Set by the Tauri sidecar only (see apps/desktop/src-tauri/src/main.rs)
    // — dev/CI use `pnpm db:migrate:dev` / `db:migrate:deploy` directly.
    if (process.env.TCG_VAULT_DESKTOP === "1") {
      const { exitWithParent } = await import("./lib/parent-watchdog");
      exitWithParent(process.env.TCG_VAULT_PARENT_PID);

      const { runMigrations } = await import("./lib/migrate");
      await runMigrations();
    }

    // Base rows (games, languages) a fresh database needs before anything is synced.
    const { ensureBaseData, enableConcurrentReads, backfillSetCategories } = await import(
      "@tcg-vault/db"
    );
    await enableConcurrentReads();
    await ensureBaseData();
    await backfillSetCategories().catch((err) =>
      console.warn("[startup] couldn't backfill set categories:", err),
    );

    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();

    // Catalog sync (and later price refresh) in the background, a few seconds
    // after startup so the first page render never waits on it.
    const { startBackgroundJobs } = await import("./lib/background");
    startBackgroundJobs();
  }
}
