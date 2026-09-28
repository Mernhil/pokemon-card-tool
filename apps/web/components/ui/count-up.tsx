"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { formatEur } from "../money";

/** A number that counts up to its value the first time it scrolls into view. */
export function CountUp({
  value,
  format,
  duration = 0.9,
}: {
  value: number;
  format: "eur" | "int";
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const fmt = (v: number) =>
    format === "eur" ? formatEur(Math.round(v)) : Math.round(v).toLocaleString("en-US");

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduced) {
      el.textContent = fmt(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        el.textContent = fmt(v);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, reduced, duration, format]);

  // Server-rendered final value: correct even before hydration / without JS.
  return <span ref={ref}>{fmt(value)}</span>;
}
