"use client";

import { foilFor, type CardFoil } from "@tcg-vault/card-fx";
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
  imageIsFallback = false,
  name,
  number,
  rarityName,
  variants,
}: {
  imageSrc: string | null;
  /** `imageSrc` is another printing's art (this printing has no scan yet). */
  imageIsFallback?: boolean;
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
      {imageIsFallback ? (
        <p className="text-center text-[11px] text-neutral-400">
          No scan for this printing yet — showing the original printing&apos;s art
        </p>
      ) : null}
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
          imageIsFallback={imageIsFallback}
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
  imageIsFallback = false,
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
  imageIsFallback?: boolean;
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
    if (reducedMotion()) return;
    flyRef.current?.animate(
      [
        { transform: `${fromOrigin()} rotateY(0deg)` },
        { transform: "translate(0, 0) scale(1) rotateY(360deg)" },
      ],
      { duration: 650, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  }, [fromOrigin]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
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
      <div
        ref={backdropRef}
        className="pointer-events-none absolute inset-0 -z-10 bg-black/90 backdrop-blur-sm"
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
      {imageIsFallback ? (
        <p className="relative z-10 -mt-2 text-xs text-white/40">
          No scan for this printing yet — showing the original printing&apos;s art
        </p>
      ) : null}

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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const REST = { tiltX: 0, tiltY: 0, rotX: 0, rotY: 0, zoom: 1, mx: 50, my: 50 };

/**
 * The card itself. All motion is written straight to CSS custom properties
 * on the element (no React re-render per pointer move); globals.css turns
 * them into the transform, foil position and glare.
 */
function Card3D({
  imageSrc,
  name,
  number,
  foil,
  mode,
  onActivate,
  controlsRef,
}: {
  imageSrc: string | null;
  name: string;
  number: string;
  foil: CardFoil;
  mode: "inline" | "inspect";
  onActivate?: () => void;
  controlsRef?: React.MutableRefObject<Card3DControls | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Target pose: hover tilt (springs back), drag rotation (stays), zoom.
  const state = useRef({ ...REST });
  // What's on screen; eased toward `state` every frame (spring-like follow).
  const shown = useRef({ ...REST });
  const stiffness = useRef(0.12);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const frame = useRef(0);
  const running = useRef(false);

  const render = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const s = shown.current;
    const rx = s.rotX + s.tiltX;
    const ry = s.rotY + s.tiltY;
    el.style.setProperty("--rx", `${rx}deg`);
    el.style.setProperty("--ry", `${ry}deg`);
    el.style.setProperty("--zoom", String(s.zoom));
    el.style.setProperty("--mx", `${s.mx}%`);
    el.style.setProperty("--my", `${s.my}%`);
    // The foil sheen slides with the viewing angle, like light on a real card.
    el.style.setProperty("--foil-x", `${50 + ry * 2.2}%`);
    el.style.setProperty("--foil-y", `${50 - rx * 2.2}%`);
    const energy = Math.min(1, Math.hypot(s.tiltX, s.tiltY, (s.rotX % 180) / 4) / 16);
    el.style.setProperty("--energy", String(0.3 + energy * 0.7));
  }, []);

  const apply = useCallback(() => {
    if (running.current) return;
    running.current = true;
    const step = () => {
      const target = state.current;
      const s = shown.current;
      let moving = false;
      for (const key of Object.keys(target) as (keyof typeof REST)[]) {
        const delta = target[key] - s[key];
        if (Math.abs(delta) > 0.01) {
          s[key] += delta * stiffness.current;
          moving = true;
        } else {
          s[key] = target[key];
        }
      }
      render();
      if (moving) {
        frame.current = requestAnimationFrame(step);
      } else {
        running.current = false;
      }
    };
    frame.current = requestAnimationFrame(step);
  }, [render]);

  const reset = useCallback(() => {
    const el = ref.current;
    el?.classList.remove("is-dragging");
    // Unwind extra full turns so "reset" doesn't spin the card several times.
    shown.current.rotY %= 360;
    Object.assign(state.current, REST);
    stiffness.current = 0.12;
    apply();
  }, [apply]);

  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      zoomBy: (d) => {
        state.current.zoom = clamp(state.current.zoom + d, 0.6, 2.5);
        apply();
      },
      flip: () => {
        state.current.rotY += 180;
        apply();
      },
      reset,
    };
  }, [controlsRef, apply, reset]);

  useEffect(() => {
    render();
    return () => cancelAnimationFrame(frame.current);
  }, [render]);

  const maxTilt = mode === "inline" ? 14 : 10;

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const s = state.current;
    // Measure the untransformed stage, not `el` itself: `el` carries the
    // live rotateX/rotateY/scale transform, so its own bounding rect is the
    // foreshortened, skewed *screen-space* box of the rotated card, not its
    // layout box — using it here made the pointer-relative tilt/glare math
    // (and the reset-drag glitch after releasing a rotated/zoomed card)
    // wildly unstable in inspect mode. The stage wrapper never transforms.
    const rect = (el.parentElement ?? el).getBoundingClientRect();
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      // Normalized by the stage's own box, not raw CSS pixels: dragging
      // across the full width/height always produces the same rotation
      // regardless of any mismatch between reported pointer deltas and the
      // rendered box (seen on some WebView2/Windows display-scaling setups,
      // where a full mouse drag barely rotated the card and, since the
      // foil sheen position is also driven by rotation, made the holo
      // effect look inert too).
      s.rotY += (dx / rect.width) * 320;
      s.rotX = clamp(s.rotX - (dy / rect.height) * 320, -75, 75);
      stiffness.current = 0.35;
      apply();
      return;
    }
    const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const py = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    s.tiltY = (px - 0.5) * 2 * maxTilt;
    s.tiltX = (0.5 - py) * 2 * maxTilt;
    s.mx = px * 100;
    s.my = py * 100;
    if (mode === "inline") s.zoom = 1.04; // lift toward the viewer on hover
    stiffness.current = 0.14;
    el.classList.add("is-active");
    apply();
  };

  const onPointerLeave = () => {
    if (drag.current) return;
    const s = state.current;
    s.tiltX = 0;
    s.tiltY = 0;
    s.mx = 50;
    s.my = 50;
    if (mode === "inline") s.zoom = 1;
    stiffness.current = 0.08;
    ref.current?.classList.remove("is-active");
    apply();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "inspect") return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    ref.current?.setPointerCapture(e.pointerId);
    ref.current?.classList.add("is-dragging");
    state.current.tiltX = 0;
    state.current.tiltY = 0;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      ref.current?.releasePointerCapture(e.pointerId);
      ref.current?.classList.remove("is-dragging");
      drag.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (mode !== "inspect") return;
    state.current.zoom = clamp(state.current.zoom - e.deltaY * 0.0015, 0.6, 2.5);
    apply();
  };

  return (
    <div
      className={`card3d-stage ${mode === "inspect" ? "card3d-stage--inspect" : ""}`}
      onWheel={onWheel}
    >
      <div
        ref={ref}
        className={`card3d card3d--${foil.area} card3d--${foil.preset.pattern} card3d--preset-${foil.preset.slug}`}
        style={
          {
            "--intensity": String(foil.preset.params.intensity),
          } as React.CSSProperties
        }
        role={mode === "inline" ? "button" : "img"}
        tabIndex={mode === "inline" ? 0 : undefined}
        aria-label={mode === "inline" ? `Inspect ${name}` : name}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={mode === "inspect" ? reset : undefined}
        onClick={mode === "inline" ? onActivate : undefined}
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
        <div className="card3d__face card3d__front">
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
          {foil.area !== "none" ? <div className="card3d__foil" aria-hidden /> : null}
          <div className="card3d__glare" aria-hidden />
        </div>
        <div className="card3d__face card3d__back" aria-hidden>
          <div className="card3d__back-emblem">TCG Vault</div>
        </div>
      </div>
    </div>
  );
}
