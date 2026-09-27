"use client";

import type { Pocket as PocketData } from "@tcg-vault/db/src/binder-types";
import {
  animate,
  motion,
  motionValue,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Pocket } from "./pocket";

/*
 * Page model, like a real binder: spread 0 = [inside front cover | page 0],
 * spread k = [page 2k-1 | page 2k]. Each turning leaf has an even page on
 * its front and the next odd page on its back. Turning forward from spread
 * k rotates leaf k (front: page 2k, back: page 2k+1) from 0° to -180°
 * around the rings; turning back rotates leaf k-1 from -180° to 0°.
 */

export const spreadCount = (pageCount: number) => Math.floor(pageCount / 2) + 1;

export interface SpreadHandle {
  turn: (dir: 1 | -1) => void;
}

interface Flip {
  dir: 1 | -1;
  /** Angle tracked by the leaf: 0 = lying on the right, -180 = on the left. */
  angle: MotionValue<number>;
}

const EASE = [0.3, 0.7, 0.3, 1] as const;

/** Page proportions for a rows x cols page (a card is 5 x 7, plus gutters). */
export function pageGeometry(rows: number, cols: number) {
  const gap = 0.45;
  const pad = 0.9;
  const ringMargin = 0.7;
  const width = cols * 5 + (cols - 1) * gap + 2 * pad + ringMargin;
  const height = rows * 7 + (rows - 1) * gap + 2 * pad;
  const cq = (units: number) => `${((units / width) * 100).toFixed(3)}cqw`;
  return {
    aspect: width / height,
    style: {
      "--page-pad": cq(pad),
      "--page-gap": cq(gap),
      "--page-ring": cq(ringMargin),
      "--page-cols": cols,
      "--page-rows": rows,
    } as CSSProperties,
  };
}

export const BinderSpread = forwardRef<
  SpreadHandle,
  {
    pages: PocketData[][];
    rows: number;
    cols: number;
    spread: number;
    onSpreadChange: (spread: number) => void;
    insideFront: ReactNode;
    insideBack: ReactNode;
    frontCover: ReactNode;
    onOpenPocket: (e: MouseEvent<HTMLElement>, page: number, position: number) => void;
    onPocketMenu: (e: MouseEvent<HTMLElement>, page: number, position: number) => void;
  }
>(function BinderSpread(
  {
    pages,
    rows,
    cols,
    spread,
    onSpreadChange,
    insideFront,
    insideBack,
    frontCover,
    onOpenPocket,
    onPocketMenu,
  },
  ref,
) {
  const reduced = useReducedMotion();
  const [flip, setFlip] = useState<Flip | null>(null);
  const flipRef = useRef<Flip | null>(null);
  flipRef.current = flip;
  const spreadRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number } | null>(null);
  const [coverOpen, setCoverOpen] = useState(Boolean(reduced));
  const coverAngle = useMotionValue(0);

  const total = spreadCount(pages.length);
  const geo = pageGeometry(rows, cols);

  // The front cover swings open once when the binder is opened.
  useEffect(() => {
    if (reduced) return;
    const controls = animate(coverAngle, -180, { duration: 1.05, delay: 0.25, ease: EASE });
    controls.then(() => setCoverOpen(true));
    return () => controls.stop();
  }, [coverAngle, reduced]);

  const finish = useCallback(
    (f: Flip, complete: boolean) => {
      const target = complete ? (f.dir === 1 ? -180 : 0) : f.dir === 1 ? 0 : -180;
      const remaining = Math.abs(f.angle.get() - target) / 180;
      animate(f.angle, target, {
        duration: reduced ? 0 : 0.25 + 0.45 * remaining,
        ease: EASE,
      }).then(() => {
        if (complete) onSpreadChange(spread + f.dir);
        setFlip(null);
      });
    },
    [onSpreadChange, reduced, spread],
  );

  const start = useCallback(
    (dir: 1 | -1): Flip | null => {
      if (flipRef.current) return null;
      if (dir === 1 && spread >= total - 1) return null;
      if (dir === -1 && spread <= 0) return null;
      // A fresh value per turn (useMotionValue can't be called in a callback).
      const f: Flip = { dir, angle: motionValue(dir === 1 ? 0 : -180) };
      setFlip(f);
      return f;
    },
    [spread, total],
  );

  const turn = useCallback(
    (dir: 1 | -1) => {
      const f = start(dir);
      if (f) requestAnimationFrame(() => finish(f, true));
    },
    [start, finish],
  );

  useImperativeHandle(ref, () => ({ turn }), [turn]);

  // Drag a page corner: the leaf's edge follows the pointer.
  const angleFromPointer = (clientX: number) => {
    const rect = spreadRef.current!.getBoundingClientRect();
    const half = rect.width / 2;
    const rel = Math.max(-1, Math.min(1, (clientX - (rect.left + half)) / half));
    return (-Math.acos(rel) * 180) / Math.PI;
  };
  const onCornerDown = (dir: 1 | -1) => (e: React.PointerEvent) => {
    const f = start(dir);
    if (!f) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId };
  };
  const onCornerMove = (e: React.PointerEvent) => {
    const f = flipRef.current;
    if (!drag.current || !f) return;
    f.angle.set(angleFromPointer(e.clientX));
  };
  const onCornerUp = (e: React.PointerEvent) => {
    const f = flipRef.current;
    if (!drag.current || !f) return;
    drag.current = null;
    const a = f.angle.get();
    const moved = f.dir === 1 ? a < -8 : a > -172;
    // A click without dragging turns the page too.
    const complete = !moved || (f.dir === 1 ? a < -80 : a > -100);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    finish(f, complete);
  };

  const pageAt = (index: number, interactive: boolean) => {
    if (index < 0) return <div className="binder-page binder-page--cover">{insideFront}</div>;
    if (index >= pages.length)
      return <div className="binder-page binder-page--cover">{insideBack}</div>;
    const pockets = pages[index]!;
    const byPos = new Map(pockets.map((p) => [p.position, p]));
    return (
      <div
        className={`binder-page ${index % 2 === 0 ? "binder-page--right" : "binder-page--left"}`}
        style={geo.style}
      >
        <div className="binder-page__grid">
          {Array.from({ length: rows * cols }, (_, pos) => (
            <Pocket
              key={pos}
              page={index}
              position={pos}
              data={byPos.get(pos)}
              interactive={interactive}
              onOpen={onOpenPocket}
              onMenu={onPocketMenu}
            />
          ))}
        </div>
        <span className="binder-page__number">{index + 1}</span>
      </div>
    );
  };

  // What lies flat on each side, and what's on the turning leaf.
  const leftIndex = 2 * spread - 1;
  const rightIndex = 2 * spread;
  let staticLeft = leftIndex;
  let staticRight = rightIndex;
  let leafFront = 0;
  let leafBack = 0;
  if (flip?.dir === 1) {
    staticRight = rightIndex + 2;
    leafFront = rightIndex;
    leafBack = rightIndex + 1;
  } else if (flip?.dir === -1) {
    staticLeft = leftIndex - 2;
    leafFront = leftIndex - 1;
    leafBack = leftIndex;
  }

  return (
    <div
      ref={spreadRef}
      className="binder-spread"
      style={{ "--page-aspect": geo.aspect } as CSSProperties}
    >
      <div className="binder-half binder-half--left">{pageAt(staticLeft, !flip)}</div>
      <div className="binder-half binder-half--right">{pageAt(staticRight, !flip)}</div>
      <div className="binder-rings" aria-hidden>
        <span />
        <span />
        <span />
      </div>

      {flip ? (
        <Leaf angle={flip.angle}>
          {{ front: pageAt(leafFront, false), back: pageAt(leafBack, false) }}
        </Leaf>
      ) : null}

      {!coverOpen ? (
        <Leaf angle={coverAngle} className="binder-leaf--cover">
          {{
            front: frontCover,
            // The cover's inside is the leather lining the binder opens onto.
            back: <div className="binder-page binder-page--cover">{insideFront}</div>,
          }}
        </Leaf>
      ) : null}

      {/* Corner handles: drag (or click) to turn. */}
      {spread < total - 1 ? (
        <button
          type="button"
          aria-label="Next pages"
          className="binder-corner binder-corner--right"
          onPointerDown={onCornerDown(1)}
          onPointerMove={onCornerMove}
          onPointerUp={onCornerUp}
          onPointerCancel={onCornerUp}
        />
      ) : null}
      {spread > 0 ? (
        <button
          type="button"
          aria-label="Previous pages"
          className="binder-corner binder-corner--left"
          onPointerDown={onCornerDown(-1)}
          onPointerMove={onCornerMove}
          onPointerUp={onCornerUp}
          onPointerCancel={onCornerUp}
        />
      ) : null}
    </div>
  );
});

function Leaf({
  angle,
  className = "",
  children,
}: {
  angle: MotionValue<number>;
  className?: string;
  children: { front: ReactNode; back: ReactNode };
}) {
  // Shade the leaf as it stands up (darkest at 90°), like light on a real page.
  const shade = useTransform(angle, [0, -90, -180], [0, 0.35, 0]);
  const lift = useTransform(angle, [0, -90, -180], [0, 1, 0]);
  const shadow = useTransform(
    lift,
    (l) => `0 ${8 + l * 20}px ${20 + l * 40}px rgb(0 0 0 / ${0.25 + l * 0.3})`,
  );
  return (
    <motion.div
      className={`binder-leaf ${className}`}
      style={{ rotateY: angle, boxShadow: shadow }}
    >
      <div className="binder-leaf__face binder-leaf__face--front">
        {children.front}
        <motion.div className="binder-leaf__shade" style={{ opacity: shade }} />
      </div>
      <div className="binder-leaf__face binder-leaf__face--back">
        {children.back}
        <motion.div className="binder-leaf__shade" style={{ opacity: shade }} />
      </div>
    </motion.div>
  );
}
