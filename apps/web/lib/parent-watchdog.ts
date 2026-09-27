/**
 * Desktop only: exit when the Tauri shell that spawned this server is gone.
 *
 * The shell kills the server on a normal exit, but a crash, a Task Manager
 * kill or the updater's hard exit skip that — and on Windows a child process
 * outlives its parent. An orphaned server then kept serving an old version's
 * pages to the next install. Checking the parent's PID every couple of
 * seconds (signal 0 = "does it exist", works on Windows too) closes that gap.
 */
export function exitWithParent(parentPid: string | undefined): void {
  const pid = Number(parentPid);
  if (!Number.isInteger(pid) || pid <= 0) return;

  const timer = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        console.log(`[watchdog] desktop shell (pid ${pid}) is gone — exiting`);
        process.exit(0);
      }
    }
  }, 2000);
  timer.unref();
}
