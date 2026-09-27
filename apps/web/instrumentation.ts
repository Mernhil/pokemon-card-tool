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
    const { ensureBaseData } = await import("@tcg-vault/db");
    await ensureBaseData();

    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
