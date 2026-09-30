import { describe, expect, it } from "vitest";
import {
  INERTIA_STOP,
  MAX_ROT_X,
  angularVelocity,
  applyDrag,
  approach,
  dragRotation,
  inertiaDuration,
  lightEnergy,
  nearestTurn,
  releaseVelocity,
  sheenPosition,
  stepInertia,
  wrap180,
} from "./drag";

const size = { width: 400, height: 560, zoom: 1 };

describe("dragRotation / applyDrag", () => {
  it("turns the card over (180°) when dragged across its full width", () => {
    expect(dragRotation(400, 0, size).rotY).toBeCloseTo(180, 6);
    expect(dragRotation(0, 560, size).rotX).toBeCloseTo(-180, 6);
    expect(dragRotation(100, 0, size).rotY).toBeCloseTo(45, 6);
  });

  it("scales with zoom so a zoomed card still tracks the cursor", () => {
    const zoomed = dragRotation(100, 0, { ...size, zoom: 2 });
    const normal = dragRotation(100, 0, size);
    expect(zoomed.rotY).toBeCloseTo(normal.rotY / 2, 6);
  });

  it("is linear: two half drags equal one whole drag", () => {
    const a = applyDrag(applyDrag({ rotX: 0, rotY: 0 }, 30, 10, size), 30, 10, size);
    const b = applyDrag({ rotX: 0, rotY: 0 }, 60, 20, size);
    expect(a.rotY).toBeCloseTo(b.rotY, 9);
    expect(a.rotX).toBeCloseTo(b.rotX, 9);
  });

  it("turns the same way at any rotY, including flipped past 90°", () => {
    for (const rotY of [0, 100, 180, 270, -200, 720 + 30]) {
      const after = applyDrag({ rotX: 10, rotY }, 40, -25, size);
      expect(after.rotY - rotY).toBeGreaterThan(0); // right drag always adds
      expect(after.rotX - 10).toBeGreaterThan(0); // up drag always tips the top back
    }
  });

  it("clamps the vertical tilt at ±75° but never the spin", () => {
    expect(applyDrag({ rotX: 70, rotY: 0 }, 0, -10_000, size).rotX).toBe(MAX_ROT_X);
    expect(applyDrag({ rotX: -70, rotY: 0 }, 0, 10_000, size).rotX).toBe(-MAX_ROT_X);
    expect(applyDrag({ rotX: 0, rotY: 0 }, 10_000, 0, size).rotY).toBeGreaterThan(720);
  });
});

describe("releaseVelocity", () => {
  const samples = [
    { t: 0, x: 0, y: 0 },
    { t: 16, x: 16, y: 0 },
    { t: 32, x: 32, y: 8 },
    { t: 48, x: 48, y: 16 },
  ];

  it("measures recent pointer speed in px/ms", () => {
    const v = releaseVelocity(samples, 50);
    expect(v.vx).toBeCloseTo(1, 6);
    expect(v.vy).toBeCloseTo(1 / 3, 6);
  });

  it("is zero when the pointer rested before release", () => {
    expect(releaseVelocity(samples, 48 + 200)).toEqual({ vx: 0, vy: 0 });
  });

  it("ignores samples older than the window", () => {
    const v = releaseVelocity(
      [{ t: 0, x: 0, y: 0 }, ...samples.map((s) => ({ ...s, t: s.t + 500, x: s.x + 900 }))],
      550,
    );
    expect(v.vx).toBeCloseTo(1, 6);
  });

  it("needs two samples, and caps flicks", () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }], 10)).toEqual({ vx: 0, vy: 0 });
    const fast = releaseVelocity(
      [
        { t: 0, x: 0, y: 0 },
        { t: 10, x: 1000, y: 0 },
      ],
      12,
      { maxSpeed: 3 },
    );
    expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(3, 6);
  });
});

describe("stepInertia", () => {
  it("is frame-rate independent", () => {
    const v0 = { rotX: 0.2, rotY: 0.6 };
    const run = (dt: number) => {
      let vel = v0;
      let rotY = 0;
      for (let t = 0; t < 240; t += dt) {
        const s = stepInertia(vel, dt);
        vel = s.vel;
        rotY += s.delta.rotY;
      }
      return rotY;
    };
    expect(run(8)).toBeCloseTo(run(16), 6);
    expect(run(16)).toBeCloseTo(run(40), 6);
  });

  it("decays and stops well inside 400ms for a normal flick", () => {
    const v = angularVelocity({ vx: 1.5, vy: 0 }, size); // a brisk 1.5 px/ms flick
    const speed = Math.hypot(v.rotX, v.rotY);
    const ms = inertiaDuration(speed);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(400);

    let vel = v;
    let t = 0;
    for (; t < 1000; t += 16) {
      const s = stepInertia(vel, 16);
      vel = s.vel;
      if (s.done) break;
    }
    expect(t).toBeLessThan(400);
    expect(Math.hypot(vel.rotX, vel.rotY)).toBeLessThan(INERTIA_STOP);
  });

  it("travels the closed-form distance v·τ as dt grows", () => {
    const s = stepInertia({ rotX: 0, rotY: 1 }, 10_000);
    expect(s.delta.rotY).toBeCloseTo(70, 4);
  });

  it("does nothing with no velocity", () => {
    expect(stepInertia({ rotX: 0, rotY: 0 }, 16).done).toBe(true);
    expect(inertiaDuration(0)).toBe(0);
  });
});

describe("approach / nearestTurn / wrap180", () => {
  it("covers half the gap per half-life, at any frame rate", () => {
    expect(approach(0, 100, 80, 80)).toBeCloseTo(50, 6);
    let v = 0;
    for (let i = 0; i < 10; i++) v = approach(v, 100, 8, 80);
    expect(v).toBeCloseTo(50, 6);
  });

  it("snaps when close, and leaves a settled value alone", () => {
    expect(approach(99.999, 100, 16, 80)).toBe(100);
    expect(approach(5, 5, 16, 80)).toBe(5);
  });

  it("resets by the shortest way round", () => {
    expect(nearestTurn(350)).toBe(360);
    expect(nearestTurn(-350)).toBe(-360);
    expect(nearestTurn(170)).toBe(0);
    expect(nearestTurn(540.1)).toBe(720);
  });

  it("wraps angles into (-180, 180]", () => {
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(wrap180(180)).toBe(180);
    expect(wrap180(-180)).toBe(180);
    expect(wrap180(720)).toBe(0);
  });
});

describe("sheenPosition / lightEnergy", () => {
  it("is centred at rest and stays within the layer for any angle", () => {
    expect(sheenPosition(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    for (const rotY of [-900, -181, 0, 45, 180, 1234]) {
      for (const rotX of [-75, 0, 75]) {
        for (const m of [0, 50, 100]) {
          const p = sheenPosition(rotX, rotY, m, m);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(1);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("follows the viewing angle and the pointer in the same direction as before", () => {
    expect(sheenPosition(0, 20).x).toBeGreaterThan(0.5);
    expect(sheenPosition(20, 0).y).toBeLessThan(0.5);
    expect(sheenPosition(0, 0, 100, 50).x).toBeGreaterThan(0.5);
  });

  it("is smooth wherever the front face is visible (|angle| < 90°)", () => {
    let prev = sheenPosition(0, -89).x;
    for (let deg = -88; deg <= 89; deg++) {
      const x = sheenPosition(0, deg).x;
      expect(Math.abs(x - prev)).toBeLessThan(0.06);
      prev = x;
    }
    // It only jumps at ±180°, where the card is showing its back.
    expect(sheenPosition(0, 360 + 30).x).toBeCloseTo(sheenPosition(0, 30).x, 9);
  });

  it("energy stays in 0.3-1 and rises with tilt", () => {
    expect(lightEnergy(0, 0, 0, 0)).toBeCloseTo(0.3, 6);
    expect(lightEnergy(60, 120, 10, 10, 100, 100)).toBeLessThanOrEqual(1);
    expect(lightEnergy(40, 0, 0, 0)).toBeGreaterThan(lightEnergy(0, 0, 0, 0));
  });
});
