/**
 * Pure maths for the card inspector's drag / inertia / easing, kept out of the
 * component so it can be tested and so every rule lives in one place.
 *
 * Conventions: angles in degrees, time in ms, pointer distances in CSS px.
 * The card is posed as `rotateX(rotX) rotateY(rotY)` (X outermost), so a
 * vertical drag always tilts about the *screen's* horizontal axis and a
 * horizontal drag always spins about the card's own vertical axis — both feel
 * the same whether or not the card is flipped (rotY past 90°).
 */

export interface Pose {
  rotX: number;
  rotY: number;
}

export interface CardSize {
  /** Unzoomed on-screen card size. */
  width: number;
  height: number;
  zoom: number;
}

/** A vertical drag never tips the card past this (it would go edge-on / upside down). */
export const MAX_ROT_X = 75;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Degrees of rotation for a pointer movement: dragging across the card's full
 * on-screen width (or height) turns it 180°, the gesture of flipping a card by
 * swiping over it. It's proportional to the card's own size — not a fixed
 * degrees-per-pixel guess — so it feels the same at any zoom level, window
 * size or display scaling, and it's exactly linear (no easing), so the card
 * stays under the cursor.
 */
export function dragRotation(dx: number, dy: number, size: CardSize): Pose {
  const w = Math.max(1, size.width * size.zoom);
  const h = Math.max(1, size.height * size.zoom);
  return { rotY: (dx / w) * 180, rotX: -(dy / h) * 180 };
}

export function applyDrag(pose: Pose, dx: number, dy: number, size: CardSize): Pose {
  const d = dragRotation(dx, dy, size);
  return { rotY: pose.rotY + d.rotY, rotX: clamp(pose.rotX + d.rotX, -MAX_ROT_X, MAX_ROT_X) };
}

export interface PointerSample {
  t: number;
  x: number;
  y: number;
}

export interface Velocity {
  /** px per ms */
  vx: number;
  vy: number;
}

export interface ReleaseOptions {
  /** Only samples this recent count towards the release velocity. */
  windowMs?: number;
  /** If the pointer stopped this long before release, there's no inertia. */
  staleMs?: number;
  /** Cap, px/ms — a flick shouldn't spin the card for ever. */
  maxSpeed?: number;
}

/** Pointer velocity at release, from the recent samples; zero if it paused first. */
export function releaseVelocity(
  samples: PointerSample[],
  releaseT: number,
  { windowMs = 90, staleMs = 60, maxSpeed = 3 }: ReleaseOptions = {},
): Velocity {
  const last = samples[samples.length - 1];
  if (!last || releaseT - last.t > staleMs) return { vx: 0, vy: 0 };
  const recent = samples.filter((s) => last.t - s.t <= windowMs);
  const first = recent[0]!;
  const dt = last.t - first.t;
  if (recent.length < 2 || dt <= 0) return { vx: 0, vy: 0 };
  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  const k = speed > maxSpeed ? maxSpeed / speed : 1;
  return { vx: vx * k, vy: vy * k };
}

/** Angular velocity (deg/ms) a pointer velocity turns into, for a card of this size. */
export function angularVelocity(v: Velocity, size: CardSize): Pose {
  const d = dragRotation(v.vx, v.vy, size);
  return d; // dragRotation is linear, so per-ms pixels map to per-ms degrees
}

export const INERTIA_TAU_MS = 70;
/** Below this angular speed (deg/ms) the card is considered stopped. */
export const INERTIA_STOP = 0.006;

export interface InertiaStep {
  /** Velocity after the step (deg/ms). */
  vel: Pose;
  /** Rotation to add this step (deg). */
  delta: Pose;
  done: boolean;
}

/**
 * Exponentially damped glide. Closed-form for the step, so it gives the same
 * result at 30, 60 or 144 fps.
 */
export function stepInertia(vel: Pose, dtMs: number, tauMs = INERTIA_TAU_MS): InertiaStep {
  const decay = Math.exp(-dtMs / tauMs);
  const travel = tauMs * (1 - decay); // ∫ v·e^(-t/τ) dt, per unit of initial velocity
  const next = { rotX: vel.rotX * decay, rotY: vel.rotY * decay };
  return {
    vel: next,
    delta: { rotX: vel.rotX * travel, rotY: vel.rotY * travel },
    done: Math.hypot(next.rotX, next.rotY) < INERTIA_STOP,
  };
}

/** How long a glide from `speed` (deg/ms) lasts before it stops. */
export function inertiaDuration(speed: number, tauMs = INERTIA_TAU_MS): number {
  return speed <= INERTIA_STOP ? 0 : tauMs * Math.log(speed / INERTIA_STOP);
}

/** Frame-rate independent exponential approach: covers half the gap every `halfLifeMs`. */
export function approach(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs: number,
): number {
  if (current === target) return target;
  const next = current + (target - current) * (1 - Math.pow(0.5, dtMs / halfLifeMs));
  return Math.abs(target - next) < 0.005 ? target : next;
}

/** The multiple of 360° nearest to `rotY`: where "reset" should settle, so it never spins the long way round. */
export function nearestTurn(rotY: number): number {
  return 360 * Math.round(rotY / 360);
}

/** Wraps an angle to (-180, 180]. */
export function wrap180(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/**
 * Where the foil sheen sits (0-1 on each axis, 0.5 = centred): it slides with
 * the viewing angle, like light on a real card, plus a small pull towards the
 * pointer. Bounded (tanh) so the sheen layer never needs to wrap or tile.
 * `mx`/`my` are the pointer position over the card in percent.
 */
export function sheenPosition(
  rotX: number,
  rotY: number,
  mx = 50,
  my = 50,
): { x: number; y: number } {
  const ax = Math.tanh((wrap180(rotY) * 2.2) / 50);
  const ay = Math.tanh((-rotX * 2.2) / 50);
  return {
    x: clamp(0.5 + 0.5 * ax + ((mx - 50) / 100) * 0.3, 0, 1),
    y: clamp(0.5 + 0.5 * ay + ((my - 50) / 100) * 0.3, 0, 1),
  };
}

/** 0.3-1: how strongly the light shows (idle → faint, tilted or lit from an edge → bright). */
export function lightEnergy(
  rotX: number,
  rotY: number,
  tiltX: number,
  tiltY: number,
  mx = 50,
  my = 50,
): number {
  const pose = Math.hypot(tiltX, tiltY, wrap180(rotY) / 4, rotX / 4) / 16;
  const pointer = Math.hypot(mx - 50, my - 50) / 70;
  return 0.3 + 0.7 * Math.min(1, Math.max(pose, pointer * 0.6));
}
