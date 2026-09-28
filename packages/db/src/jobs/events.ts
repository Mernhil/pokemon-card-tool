import { EventEmitter } from "node:events";

/**
 * Everything a job run reports, on one process-wide bus. The progress
 * registry below listens to it for the UI's progress indicator; the Sync
 * page's stream (apps/web/app/api/sync) listens for per-card detail.
 */
export type JobEvent = { job: string; game: string } & (
  | { type: "run-start" }
  | { type: "run-end"; status: JobRunStatus; succeeded: number; failed: number }
  | { type: "item-start"; key: string; label: string | null }
  | { type: "item-done"; key: string; label: string | null }
  | {
      type: "item-retry";
      key: string;
      label: string | null;
      attempt: number;
      waitMs: number;
      error: string;
    }
  | { type: "item-failed"; key: string; label: string | null; error: string }
  /** Job-specific detail (e.g. catalog's per-card progress); `data` is the job's own shape. */
  | { type: "detail"; key: string; data: unknown }
);

export type JobRunStatus = "completed" | "locked" | "aborted" | "halted";

export interface JobProgress {
  job: string;
  game: string;
  running: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastStatus: JobRunStatus | null;
  /** Items processed in the current/last run. */
  succeeded: number;
  failed: number;
  current: Array<{ key: string; label: string | null }>;
  recentErrors: Array<{ key: string; label: string | null; error: string; at: Date }>;
}

interface Registry {
  bus: EventEmitter;
  progress: Map<string, JobProgress>;
}

// On globalThis so Next.js dev-mode module reloads don't split the registry.
const globalRegistry = globalThis as unknown as { __tcgVaultJobs?: Registry };

function registry(): Registry {
  if (!globalRegistry.__tcgVaultJobs) {
    const bus = new EventEmitter();
    bus.setMaxListeners(100);
    const reg: Registry = { bus, progress: new Map() };
    bus.on("event", (e: JobEvent) => track(reg.progress, e));
    globalRegistry.__tcgVaultJobs = reg;
  }
  return globalRegistry.__tcgVaultJobs;
}

const progressKey = (job: string, game: string) => `${job}\u0000${game}`;

function track(map: Map<string, JobProgress>, e: JobEvent): void {
  const key = progressKey(e.job, e.game);
  let p = map.get(key);
  if (!p) {
    p = {
      job: e.job,
      game: e.game,
      running: false,
      startedAt: null,
      finishedAt: null,
      lastStatus: null,
      succeeded: 0,
      failed: 0,
      current: [],
      recentErrors: [],
    };
    map.set(key, p);
  }
  switch (e.type) {
    case "run-start":
      Object.assign(p, {
        running: true,
        startedAt: new Date(),
        finishedAt: null,
        succeeded: 0,
        failed: 0,
        current: [],
        recentErrors: [],
      });
      break;
    case "run-end":
      // A "locked" run never started; don't clobber the real run's state.
      if (e.status === "locked") break;
      Object.assign(p, {
        running: false,
        finishedAt: new Date(),
        lastStatus: e.status,
        current: [],
      });
      break;
    case "item-start":
      p.current = [...p.current.filter((c) => c.key !== e.key), { key: e.key, label: e.label }];
      break;
    case "item-done":
      p.succeeded++;
      p.current = p.current.filter((c) => c.key !== e.key);
      break;
    case "item-failed":
      p.failed++;
      p.current = p.current.filter((c) => c.key !== e.key);
      p.recentErrors = [
        { key: e.key, label: e.label, error: e.error, at: new Date() },
        ...p.recentErrors,
      ].slice(0, 20);
      break;
    default:
      break;
  }
}

export function emitJobEvent(event: JobEvent): void {
  registry().bus.emit("event", event);
}

/** Subscribes to every job event; returns the unsubscribe function. */
export function onJobEvent(listener: (event: JobEvent) => void): () => void {
  const { bus } = registry();
  bus.on("event", listener);
  return () => bus.off("event", listener);
}

/** In-memory progress of the current (or last) run in this process, if any. */
export function getJobProgress(job: string, game: string): JobProgress | null {
  const p = registry().progress.get(progressKey(job, game));
  return p ? { ...p, current: [...p.current], recentErrors: [...p.recentErrors] } : null;
}
