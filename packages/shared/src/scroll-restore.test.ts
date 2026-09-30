import { describe, expect, it } from "vitest";
import {
  createOnceGate,
  historyDirectionForMouseButton,
  shouldRecordScroll,
  startScrollRestore,
  type RestoreEnv,
} from "./scroll-restore";

/** A page whose height and scroll position the test drives, one frame at a time. */
function fakeEnv(opts: { maxScroll: number | ((frame: number) => number); y?: number }) {
  let frame = 0;
  let y = opts.y ?? 0;
  let pending: (() => void) | null = null;
  const scrolls: number[] = [];
  const max = () => (typeof opts.maxScroll === "function" ? opts.maxScroll(frame) : opts.maxScroll);
  const env: RestoreEnv = {
    now: () => frame * 16,
    requestFrame: (cb) => {
      pending = cb;
      return () => {
        if (pending === cb) pending = null;
      };
    },
    scrollY: () => y,
    maxScrollY: max,
    scrollTo: (to) => {
      y = Math.min(to, max());
      scrolls.push(to);
    },
  };
  return {
    env,
    scrolls,
    setY: (v: number) => (y = v),
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        frame++;
        const cb = pending;
        pending = null;
        cb?.();
      }
    },
  };
}

describe("startScrollRestore", () => {
  it("restores immediately when the page is already tall enough, then settles", async () => {
    const f = fakeEnv({ maxScroll: 5000 });
    const h = startScrollRestore(1200, f.env);
    expect(f.scrolls).toEqual([1200]);
    f.tick(20);
    expect(await h.done).toBe("restored");
  });

  it("waits for the page to grow instead of restoring to a clamped position", async () => {
    const f = fakeEnv({ maxScroll: (frame) => (frame < 10 ? 300 : 5000) });
    const h = startScrollRestore(1200, f.env);
    f.tick(9);
    expect(f.env.scrollY()).toBeLessThan(1200); // not "done" at 300
    let settled = false;
    void h.done.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    f.tick(30);
    expect(f.env.scrollY()).toBe(1200);
    expect(await h.done).toBe("restored");
  });

  it("re-applies the target when the router scrolls back to the top", async () => {
    const f = fakeEnv({ maxScroll: 5000 });
    const h = startScrollRestore(800, f.env);
    f.tick(3);
    f.setY(0); // Next's scroll reset lands after our first restore
    f.tick(1);
    expect(f.env.scrollY()).toBe(800);
    f.tick(30);
    expect(await h.done).toBe("restored");
    expect(f.scrolls.length).toBeGreaterThanOrEqual(2);
  });

  it("gives up after the timeout when the page never gets tall enough", async () => {
    const f = fakeEnv({ maxScroll: 100 });
    const h = startScrollRestore(1200, f.env, { timeoutMs: 500 });
    f.tick(60);
    expect(await h.done).toBe("timeout");
    expect(f.env.scrollY()).toBe(100);
  });

  it("stops touching the scroll position once cancelled", async () => {
    const f = fakeEnv({ maxScroll: 5000 });
    const h = startScrollRestore(800, f.env);
    h.cancel();
    f.setY(50);
    f.tick(5);
    expect(f.env.scrollY()).toBe(50);
    expect(await h.done).toBe("cancelled");
  });
});

describe("mouse side buttons", () => {
  it("maps button 3 to back and 4 to forward, ignoring the rest", () => {
    expect(historyDirectionForMouseButton(3)).toBe("back");
    expect(historyDirectionForMouseButton(4)).toBe("forward");
    for (const b of [0, 1, 2, 5]) expect(historyDirectionForMouseButton(b)).toBeNull();
  });

  it("lets one press through per window", () => {
    let t = 1000;
    const gate = createOnceGate(300, () => t);
    expect(gate()).toBe(true);
    t += 50;
    expect(gate()).toBe(false); // the same press seen by a second event
    t += 400;
    expect(gate()).toBe(true);
  });
});

describe("shouldRecordScroll", () => {
  it("ignores scroll events once the URL has moved on", () => {
    expect(shouldRecordScroll("/pokemon/sv1", "/pokemon/sv1")).toBe(true);
    expect(shouldRecordScroll("/pokemon/sv1", "/pokemon/sv1/25")).toBe(false);
  });
});
