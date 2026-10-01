"use client";

import {
  FOIL_ENABLED,
  INERTIA_STOP,
  angularVelocity,
  applyDrag,
  approach,
  clamp,
  foilFor,
  lightEnergy,
  nearestTurn,
  releaseVelocity,
  sheenPosition,
  stepInertia,
  MAX_ROT_X,
  type CardFoil,
  type PointerSample,
  type Pose,
} from "@tcg-vault/card-fx";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ViewerVariant {
  id: string;
  finish: string;
}

const FINISH_LABELS: Record<string, string> = {
  NON_FOIL: "Normal",
  HOLO: "Holo",
  REVERSE_HOLO: "Reverse holo",
};

/**
 * Interactive card: tilts toward the pointer with light glare and the foil
 * that matches the chosen variant (see foilFor in packages/card-fx). Click
 * it to inspect full-screen, where it can be dragged around freely (and
 * flipped), zoomed, and reset.
 */
export function CardViewer({
  imageSrc,
  name,
  number,
  rarityName,
  variants,
}: {
  imageSrc: string | null;
  name: string;
  number: string;
  rarityName: string | null;
  variants: ViewerVariant[];
}) {
  // Default to the flashiest version the card exists in.
  const finishes = [...new Set(variants.map((v) => v.finish))];
  const [finish, setFinish] = useState(
    finishes.find((f) => f !== "NON_FOIL") ?? finishes[0] ?? "NON_FOIL",
  );
  const [inspecting, setInspecting] = useState<DOMRect | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const foil = foilFor(finish, rarityName);
  const inspect = () => {
    const rect = inlineRef.current?.getBoundingClientRect();
    if (rect) setInspecting(rect);
  };

  return (
    <div className="flex w-56 shrink-0 flex-col items-center gap-3 self-start">
      <div
        ref={inlineRef}
        className="w-full"
        style={{ visibility: inspecting ? "hidden" : undefined }}
      >
        <Card3D
          imageSrc={imageSrc}
          name={name}
          number={number}
          foil={foil}
          mode="inline"
          onActivate={inspect}
        />
      </div>
      <FinishPicker finishes={finishes} value={finish} onChange={setFinish} />
      <button
        type="button"
        onClick={inspect}
        className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
      >
        Inspect card ⤢
      </button>

      {inspecting ? (
        <CardInspector
          imageSrc={imageSrc}
          name={name}
          number={number}
          rarityName={rarityName}
          finishes={finishes}
          finish={finish}
          onFinishChange={setFinish}
          origin={inspecting}
          onClose={() => setInspecting(null)}
        />
      ) : null}
    </div>
  );
}

function FinishPicker({
  finishes,
  value,
  onChange,
  dark = false,
}: {
  finishes: string[];
  value: string;
  onChange: (finish: string) => void;
  dark?: boolean;
}) {
  if (finishes.length < 2) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1" role="radiogroup" aria-label="Finish">
      {finishes.map((f) => {
        const active = f === value;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(f)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              active
                ? dark
                  ? "border-white bg-white text-black"
                  : "border-neutral-900 bg-neutral-900 text-neutral-50"
                : dark
                  ? "border-white/40 text-white/80 hover:border-white"
                  : "border-neutral-300 text-neutral-600 hover:border-neutral-500"
            }`}
          >
            {FINISH_LABELS[f] ?? f.replaceAll("_", " ").toLowerCase()}
          </button>
        );
      })}
    </div>
  );
}

export function CardInspector({
  imageSrc,
  name,
  number,
  rarityName,
  finishes,
  finish,
  onFinishChange,
  origin,
  onClose,
}: {
  imageSrc: string | null;
  name: string;
  number: string;
  rarityName: string | null;
  finishes: string[];
  finish: string;
  onFinishChange: (finish: string) => void;
  origin: DOMRect;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const controls = useRef<Card3DControls | null>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  // Pointer input is ignored until the fly-in has finished: the fly element is
  // mid-flight (rotating, scaled) for 650 ms, and drag/tilt maths against it
  // would be garbage.
  const [ready, setReady] = useState(false);

  /** Transform that puts the big card exactly over the small inline one. */
  const fromOrigin = useCallback(() => {
    const el = flyRef.current;
    if (!el) return "none";
    const rect = el.getBoundingClientRect();
    const dx = origin.left + origin.width / 2 - (rect.left + rect.width / 2);
    const dy = origin.top + origin.height / 2 - (rect.top + rect.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${origin.width / rect.width})`;
  }, [origin]);

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Fly in from the inline card, spinning once as it grows.
  useEffect(() => {
    if (reducedMotion()) {
      setReady(true);
      return;
    }
    const el = flyRef.current;
    if (!el) return;
    const flight = el.animate(
      [
        { transform: `${fromOrigin()} rotateY(0deg)` },
        { transform: "translate(0, 0) scale(1) rotateY(360deg)" },
      ],
      { duration: 650, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    const fade = backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    let cancelled = false;
    flight.finished.then(
      () => {
        if (!cancelled) setReady(true);
      },
      () => {},
    );
    return () => {
      cancelled = true;
      flight.cancel();
      fade?.cancel();
    };
  }, [fromOrigin]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setReady(false);
    if (reducedMotion() || !flyRef.current) {
      onClose();
      return;
    }
    controls.current?.reset();
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 350,
      fill: "forwards",
    });
    const flight = flyRef.current.animate(
      [{ transform: "none" }, { transform: `${fromOrigin()} rotateY(-360deg)` }],
      { duration: 450, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
    );
    flight.onfinish = onClose;
  }, [fromOrigin, onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [close]);

  const button =
    "rounded border border-white/30 px-2.5 py-1 text-sm text-white/90 hover:border-white hover:text-white";

  // Portaled to <body>: the sticky sidebar this viewer normally lives in
  // establishes its own stacking context, which traps a `position: fixed`
  // dialog nested inside it below unrelated later siblings (e.g. the price
  // chart column painting over the "fixed" overlay and staying clickable).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Inspect ${name}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* No backdrop-filter: blurring the page behind re-ran every frame the
          page animated (it has a few CSS animations), which alone dropped the
          inspector to ~20 fps; at 90% black the blur is barely visible. */}
      <div
        ref={backdropRef}
        className="pointer-events-none absolute inset-0 -z-10 bg-black/90"
        aria-hidden
      />
      <button
        ref={closeRef}
        type="button"
        onClick={close}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full px-3 py-1 text-2xl leading-none text-white/80 hover:text-white"
      >
        ×
      </button>

      <p className="relative z-10 text-sm text-white/80">
        {name} <span className="text-white/50">· {number}</span>
      </p>

      <div
        className="relative z-0 flex min-h-0 flex-1 items-center justify-center [perspective:1600px]"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div ref={flyRef} className="card3d-fly">
          <Card3D
            imageSrc={imageSrc}
            name={name}
            number={number}
            foil={foilFor(finish, rarityName)}
            mode="inspect"
            enabled={ready}
            controlsRef={controls}
          />
        </div>
      </div>

      {/* Above the card: a zoomed card must never cover the controls. */}
      <div className="relative z-10">
        <FinishPicker finishes={finishes} value={finish} onChange={onFinishChange} dark />
      </div>
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-2">
        <button type="button" className={button} onClick={() => controls.current?.zoomBy(-0.25)}>
          −
        </button>
        <button type="button" className={button} onClick={() => controls.current?.zoomBy(0.25)}>
          +
        </button>
        <button type="button" className={button} onClick={() => controls.current?.flip()}>
          Flip
        </button>
        <button type="button" className={button} onClick={() => controls.current?.reset()}>
          Reset
        </button>
      </div>
      <p className="relative z-10 text-xs text-white/40">
        Drag to rotate · scroll to zoom · double-click to reset · Esc to close
      </p>
    </div>,
    document.body,
  );
}

interface Card3DControls {
  zoomBy: (delta: number) => void;
  flip: () => void;
  reset: () => void;
}

const REST_POSE: Pose = { rotX: 0, rotY: 0 };
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.5;
/** Half-lives (ms) of the eased parts; everything is time-based, so frame rate doesn't matter. */
const POSE_HALF_LIFE = 70;
const ZOOM_HALF_LIFE = 60;
const TILT_HALF_LIFE = 65;
const LIGHT_HALF_LIFE = 80;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Engine {
  /** What's on screen. */
  pose: Pose;
  zoom: number;
  tilt: { x: number; y: number };
  light: { x: number; y: number };
  /** Where the eased parts are heading. */
  target: Pose;
  zoomTarget: number;
  tiltTarget: { x: number; y: number };
  lightTarget: { x: number; y: number };
  drag: {
    id: number;
    x: number;
    y: number;
    moved: boolean;
    samples: PointerSample[];
    w: number;
    h: number;
  } | null;
  inertia: Pose | null;
  raf: number;
  last: number;
  written: { transform: string; vars: string };
}

/**
 * The card itself.
 *
 * Pointer handling lives on the untransformed stage / window, never on the
 * rotating `.card3d` element: its hit area changes as it turns, which used to
 * feed pointerenter/leave and the tilt maths back into themselves.
 *
 * - inline: hover tilts the card (eased), click inspects.
 * - inspect: the card is still until you press and drag; the drag maps
 *   1:1 to the cursor (no easing, no hover tilt), with a short damped glide on
 *   release. The glare and foil sheen follow the pointer without moving the card.
 *
 * Motion never goes through React state: one rAF loop (running only while
 * something changes) writes the transform straight to the element, and the
 * light position as a few custom properties on the front face. globals.css
 * turns those into transforms of the sheen/glare layers, so moving light
 * never repaints them.
 */
function Card3D({
  imageSrc,
  name,
  number,
  foil,
  mode,
  enabled = true,
  onActivate,
  controlsRef,
}: {
  imageSrc: string | null;
  name: string;
  number: string;
  foil: CardFoil;
  mode: "inline" | "inspect";
  /** Inspect only: ignore pointer input and controls (during the fly-in/out). */
  enabled?: boolean;
  onActivate?: () => void;
  controlsRef?: React.MutableRefObject<Card3DControls | null>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const eng = useRef<Engine>({
    pose: { ...REST_POSE },
    zoom: 1,
    tilt: { x: 0, y: 0 },
    light: { x: 50, y: 50 },
    target: { ...REST_POSE },
    zoomTarget: 1,
    tiltTarget: { x: 0, y: 0 },
    lightTarget: { x: 50, y: 50 },
    drag: null,
    inertia: null,
    raf: 0,
    last: 0,
    written: { transform: "", vars: "" },
  });
  /** Tears down the window listeners of an in-progress drag. */
  const stopDragListeners = useRef<(() => void) | null>(null);
  const maxTilt = mode === "inline" ? 14 : 0;

  const render = useCallback(() => {
    const card = cardRef.current;
    const front = frontRef.current;
    if (!card || !front) return;
    const e = eng.current;
    const rx = e.pose.rotX + e.tilt.x;
    const ry = e.pose.rotY + e.tilt.y;
    const transform = `scale(${e.zoom.toFixed(4)}) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
    if (transform !== e.written.transform) {
      e.written.transform = transform;
      card.style.transform = transform;
    }
    const sheen = sheenPosition(rx, ry, e.light.x, e.light.y);
    const energy = lightEnergy(rx, ry, e.tilt.x, e.tilt.y, e.light.x, e.light.y);
    const vars = `${sheen.x.toFixed(4)} ${sheen.y.toFixed(4)} ${(e.light.x / 100).toFixed(4)} ${(e.light.y / 100).toFixed(4)} ${energy.toFixed(3)}`;
    if (vars !== e.written.vars) {
      e.written.vars = vars;
      const [fx, fy, gx, gy, en] = vars.split(" ");
      front.style.setProperty("--fx", fx!);
      front.style.setProperty("--fy", fy!);
      front.style.setProperty("--gx", gx!);
      front.style.setProperty("--gy", gy!);
      card.style.setProperty("--energy", en!);
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      const e = eng.current;
      const dt = e.last ? clamp(now - e.last, 0, 48) : 16;
      e.last = now;
      let active = false;

      if (e.drag) {
        // The pose is driven by the pointer events themselves, 1:1.
        active = true;
      } else if (e.inertia) {
        const step = stepInertia(e.inertia, dt);
        e.pose.rotY += step.delta.rotY;
        e.pose.rotX = clamp(e.pose.rotX + step.delta.rotX, -MAX_ROT_X, MAX_ROT_X);
        e.inertia = step.done ? null : step.vel;
        if (e.pose.rotX === MAX_ROT_X || e.pose.rotX === -MAX_ROT_X) {
          if (e.inertia) e.inertia = { rotX: 0, rotY: e.inertia.rotY };
        }
        e.target = { ...e.pose };
        active = e.inertia !== null;
      } else {
        const rx = approach(e.pose.rotX, e.target.rotX, dt, POSE_HALF_LIFE);
        const ry = approach(e.pose.rotY, e.target.rotY, dt, POSE_HALF_LIFE);
        if (rx !== e.pose.rotX || ry !== e.pose.rotY) active = true;
        e.pose.rotX = rx;
        e.pose.rotY = ry;
        if (!active && Math.abs(e.pose.rotY) >= 360) {
          // Settled: drop whole extra turns (looks identical, keeps numbers small).
          const turns = nearestTurn(e.pose.rotY);
          e.pose.rotY -= turns;
          e.target.rotY -= turns;
        }
      }

      const z = approach(e.zoom, e.zoomTarget, dt, ZOOM_HALF_LIFE);
      const tx = approach(e.tilt.x, e.tiltTarget.x, dt, TILT_HALF_LIFE);
      const ty = approach(e.tilt.y, e.tiltTarget.y, dt, TILT_HALF_LIFE);
      const lx = approach(e.light.x, e.lightTarget.x, dt, LIGHT_HALF_LIFE);
      const ly = approach(e.light.y, e.lightTarget.y, dt, LIGHT_HALF_LIFE);
      if (
        z !== e.zoom ||
        tx !== e.tilt.x ||
        ty !== e.tilt.y ||
        lx !== e.light.x ||
        ly !== e.light.y
      )
        active = true;
      e.zoom = z;
      e.tilt = { x: tx, y: ty };
      e.light = { x: lx, y: ly };

      render();
      if (active) {
        e.raf = requestAnimationFrame(tick);
      } else {
        e.raf = 0;
        e.last = 0;
      }
    },
    [render],
  );

  /** Makes sure the loop is running. */
  const kick = useCallback(() => {
    const e = eng.current;
    if (!e.raf) e.raf = requestAnimationFrame(tick);
  }, [tick]);

  const reset = useCallback(() => {
    const e = eng.current;
    e.inertia = null;
    // Settle on the nearest whole turn, so "reset" never spins the long way round.
    e.target = { rotX: 0, rotY: nearestTurn(e.pose.rotY) };
    e.zoomTarget = 1;
    kick();
  }, [kick]);

  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      zoomBy: (d) => {
        if (!enabledRef.current) return;
        const e = eng.current;
        e.zoomTarget = clamp(e.zoomTarget + d, ZOOM_MIN, ZOOM_MAX);
        kick();
      },
      flip: () => {
        if (!enabledRef.current) return;
        const e = eng.current;
        e.inertia = null;
        e.target = { rotX: e.target.rotX, rotY: Math.round(e.pose.rotY / 180) * 180 + 180 };
        kick();
      },
      reset: () => {
        if (enabledRef.current) reset();
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, kick, reset]);

  useEffect(() => {
    render();
    const e = eng.current;
    return () => {
      cancelAnimationFrame(e.raf);
      e.raf = 0;
      stopDragListeners.current?.();
    };
  }, [render]);

  /** Pointer position over the stage, in percent (for the light). */
  const pointerPercent = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  };

  const moveDrag = (ev: PointerEvent) => {
    const e = eng.current;
    const d = e.drag;
    if (!d || ev.pointerId !== d.id) return;
    // A burst of moves per frame all count: coalesced events keep the drag exact.
    const events = ev.getCoalescedEvents?.() ?? [];
    for (const p of events.length > 0 ? events : [ev]) {
      const dx = p.clientX - d.x;
      const dy = p.clientY - d.y;
      d.x = p.clientX;
      d.y = p.clientY;
      if (!d.moved && Math.abs(d.x - d.samples[0]!.x) + Math.abs(d.y - d.samples[0]!.y) > 3) {
        d.moved = true;
      }
      e.pose = applyDrag(e.pose, dx, dy, { width: d.w, height: d.h, zoom: e.zoom });
      d.samples.push({ t: p.timeStamp, x: p.clientX, y: p.clientY });
    }
    if (d.samples.length > 12) d.samples.splice(0, d.samples.length - 12);
    e.target = { ...e.pose };
    const light = pointerPercent(ev.clientX, ev.clientY);
    if (light) e.lightTarget = light;
    kick();
  };

  const endDrag = (ev: PointerEvent) => {
    const e = eng.current;
    const d = e.drag;
    if (!d || ev.pointerId !== d.id) return;
    e.drag = null;
    stopDragListeners.current?.();
    if (d.moved) {
      // The click that follows a drag that began on the card must not reach the
      // dialog's click-outside-to-close.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }
    if (ev.type === "pointerup" && d.moved && !reducedMotion()) {
      const v = releaseVelocity(d.samples, ev.timeStamp);
      const ang = angularVelocity(v, { width: d.w, height: d.h, zoom: e.zoom });
      if (Math.hypot(ang.rotX, ang.rotY) > INERTIA_STOP * 4) e.inertia = ang;
    }
    kick();
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "inspect" || !enabledRef.current) return;
    if (ev.button !== 0 || !ev.isPrimary || eng.current.drag) return;
    // Any press inside the stage starts a drag — not only on the card's own
    // (rotating, foreshortened) silhouette: hit-testing a card turned nearly
    // edge-on, or flipped, is unreliable, and pressing it used to do nothing.
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const e = eng.current;
    // Take over from whatever was easing or gliding, exactly where it is now:
    // nothing jumps on press.
    e.inertia = null;
    e.target = { ...e.pose };
    e.drag = {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      moved: false,
      samples: [{ t: ev.nativeEvent.timeStamp, x: ev.clientX, y: ev.clientY }],
      w: rect.width,
      h: rect.height,
    };
    cardRef.current?.classList.add("is-dragging");
    const cancelHook = () => {
      cardRef.current?.classList.remove("is-dragging");
    };
    const onCancel = (c: PointerEvent) => endDrag(c);
    const onBlur = () => endDrag(new PointerEvent("pointercancel", { pointerId: ev.pointerId }));
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    stopDragListeners.current = () => {
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      stopDragListeners.current = null;
      cancelHook();
    };
    kick();
  };

  /** Hover (no button down). Inline: tilt + lift. Both: the light follows. */
  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const e = eng.current;
    if (e.drag || !enabledRef.current) return;
    const p = pointerPercent(ev.clientX, ev.clientY);
    if (!p) return;
    e.lightTarget = p;
    if (mode === "inline") {
      e.tiltTarget = { x: (0.5 - p.y / 100) * 2 * maxTilt, y: (p.x / 100 - 0.5) * 2 * maxTilt };
      e.zoomTarget = 1.04; // lift toward the viewer on hover
      cardRef.current?.classList.add("is-active");
    }
    kick();
  };

  const onPointerLeave = () => {
    const e = eng.current;
    if (e.drag) return;
    e.lightTarget = { x: 50, y: 50 };
    if (mode === "inline") {
      e.tiltTarget = { x: 0, y: 0 };
      e.zoomTarget = 1;
      cardRef.current?.classList.remove("is-active");
    }
    kick();
  };

  const onWheel = (ev: React.WheelEvent<HTMLDivElement>) => {
    if (mode !== "inspect" || !enabledRef.current) return;
    const e = eng.current;
    e.zoomTarget = clamp(e.zoomTarget - ev.deltaY * 0.0015, ZOOM_MIN, ZOOM_MAX);
    kick();
  };

  return (
    <div
      ref={stageRef}
      className={`card3d-stage ${mode === "inspect" ? "card3d-stage--inspect" : ""}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onDoubleClick={mode === "inspect" ? () => enabledRef.current && reset() : undefined}
      onClick={mode === "inline" ? onActivate : undefined}
    >
      <div
        ref={cardRef}
        className={`card3d card3d--${foil.area} card3d--${foil.preset.pattern} card3d--preset-${foil.preset.slug}`}
        style={
          {
            "--intensity": String(foil.preset.params.intensity),
          } as React.CSSProperties
        }
        role={mode === "inline" ? "button" : "img"}
        tabIndex={mode === "inline" ? 0 : undefined}
        aria-label={mode === "inline" ? `Inspect ${name}` : name}
        onKeyDown={
          mode === "inline"
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate?.();
                }
              }
            : undefined
        }
      >
        <div ref={frontRef} className="card3d__face card3d__front">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt={name} draggable={false} className="card3d__img" />
          ) : (
            <div className="card3d__img flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-neutral-50 to-neutral-200 p-3 text-center">
              <span className="text-base font-semibold text-neutral-700">{name}</span>
              <span className="text-xs text-neutral-500">{number}</span>
              <span className="mt-2 text-[10px] uppercase tracking-wide text-neutral-400">
                Image not available yet
              </span>
            </div>
          )}
          {FOIL_ENABLED && foil.area !== "none" ? <div className="card3d__foil" aria-hidden /> : null}
          <div className="card3d__glare" aria-hidden />
        </div>
        <div className="card3d__face card3d__back" aria-hidden>
          <div className="card3d__back-emblem">TCG Vault</div>
        </div>
      </div>
    </div>
  );
}
