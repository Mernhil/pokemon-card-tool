/**
 * Pure logic for restoring a scroll position after navigation, kept free of
 * the DOM so it can be unit-tested with a fake environment.
 *
 * Restoring "once, after two animation frames" loses to (a) the router
 * scrolling to the top after we ran and (b) content that isn't tall enough
 * yet. So instead we keep steering the scroll position towards the target
 * every frame, until it has held still long enough or a timeout expires.
 */

export interface RestoreEnv {
  now(): number;
  /** Schedules `cb` for the next frame; returns a cancel function. */
  requestFrame(cb: () => void): () => void;
  scrollY(): number;
  /** The furthest the document can currently scroll (content height - viewport). */
  maxScrollY(): number;
  scrollTo(y: number): void;
}

export interface RestoreOptions {
  /** Give up after this long. Default 2000 ms. */
  timeoutMs?: number;
  /** Frames the target must be held, with the page tall enough, before we're done. Default 12. */
  stableFrames?: number;
}

export type RestoreOutcome = "restored" | "timeout" | "cancelled";

export interface RestoreHandle {
  cancel(): void;
  done: Promise<RestoreOutcome>;
}

export function startScrollRestore(
  target: number,
  env: RestoreEnv,
  { timeoutMs = 2000, stableFrames = 12 }: RestoreOptions = {},
): RestoreHandle {
  const start = env.now();
  let stable = 0;
  let finished = false;
  let cancelFrame: (() => void) | null = null;
  let resolve!: (o: RestoreOutcome) => void;
  const done = new Promise<RestoreOutcome>((r) => (resolve = r));

  const finish = (outcome: RestoreOutcome) => {
    if (finished) return;
    finished = true;
    cancelFrame?.();
    resolve(outcome);
  };

  const step = () => {
    if (finished) return;
    const reachable = target <= env.maxScrollY();
    // Aim for the target, or as far as the page currently goes.
    const goal = Math.max(0, Math.min(target, env.maxScrollY()));
    if (Math.abs(env.scrollY() - goal) > 1) {
      env.scrollTo(goal);
      stable = 0;
    } else if (reachable) {
      stable += 1;
      if (stable >= stableFrames) return finish("restored");
    }
    if (env.now() - start >= timeoutMs) return finish("timeout");
    cancelFrame = env.requestFrame(step);
  };

  // First attempt right away: the content is often already there.
  step();
  return { cancel: () => finish("cancelled"), done };
}

/** Navigation direction for a mouse button (3 = Back, 4 = Forward), else null. */
export function historyDirectionForMouseButton(button: number): "back" | "forward" | null {
  return button === 3 ? "back" : button === 4 ? "forward" : null;
}

/**
 * Lets an action through at most once per `windowMs`, so a webview that also
 * navigates on the side buttons (or a mousedown + auxclick pair) can't make
 * one press count twice.
 */
export function createOnceGate(windowMs: number, now: () => number = Date.now) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < windowMs) return false;
    last = t;
    return true;
  };
}

/** Whether a scroll event should be recorded: only while still on the page that owns the position. */
export function shouldRecordScroll(ownerHref: string, currentHref: string): boolean {
  return ownerHref === currentHref;
}
