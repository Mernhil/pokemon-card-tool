"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatEur } from "../money";

export interface ChartSeries {
  id: string;
  label: string;
  /** Shorter name for the direct label at the line's end (defaults to `label`). */
  shortLabel?: string;
  /** CSS colour, e.g. "var(--series-1)". */
  color: string;
  /** `v: null` breaks the line there (a data gap the chart shouldn't bridge). */
  points: Array<{ t: number; v: number | null }>;
}

type Point = { t: number; v: number };
const defined = (points: ChartSeries["points"]): Point[] =>
  points.filter((p): p is Point => p.v !== null);

/** Default: values are EUR minor units, shown in the display currency. */
const eur = (minor: number) => formatEur(minor);
const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Money-over-time line chart (one y axis, EUR unless `format` says
 * otherwise). Thin lines, recessive grid, a legend + direct end labels when
 * there's more than one series, and a hover crosshair with a tooltip of
 * every series' value that day. A `null` value breaks a line (no bridging
 * across data gaps); a point with no neighbour is drawn as a dot. A hidden
 * table carries the same data for screen readers.
 */
export function LineChart({
  series,
  height = 220,
  label,
  format = eur,
}: {
  series: ChartSeries[];
  height?: number;
  label: string;
  /** Formats a minor-unit value for the axis and tooltip. */
  format?: (minor: number) => string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const multi = series.length > 1;
  const pad = { top: 12, right: multi ? 96 : 16, bottom: 26, left: 58 };
  const times = useMemo(
    () =>
      [...new Set(series.flatMap((s) => defined(s.points).map((p) => p.t)))].sort((a, b) => a - b),
    [series],
  );
  const values = series.flatMap((s) => defined(s.points).map((p) => p.v));
  const tMin = times[0] ?? 0;
  const tMax = times[times.length - 1] ?? 1;
  const vMaxRaw = Math.max(1, ...values);
  const vMinRaw = Math.min(...values, vMaxRaw);
  // Nice y range with a little headroom; start at 0 when it's close anyway.
  const span = vMaxRaw - vMinRaw || vMaxRaw * 0.2;
  const vMin = vMinRaw - span * 0.15 < vMaxRaw * 0.25 ? 0 : vMinRaw - span * 0.15;
  const vMax = vMaxRaw + span * 0.15;
  const x = (t: number) =>
    pad.left + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (width - pad.left - pad.right);
  const y = (v: number) =>
    pad.top + (1 - (v - vMin) / (vMax - vMin)) * (height - pad.top - pad.bottom);
  const yTicks = Array.from({ length: 4 }, (_, i) => vMin + ((vMax - vMin) * i) / 3);
  const xTicks =
    times.length <= 5
      ? times
      : [0, 1, 2, 3, 4].map((i) => times[Math.round((i * (times.length - 1)) / 4)]!);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    times.forEach((t, i) => {
      if (Math.abs(x(t) - px) < Math.abs(x(times[best]!) - px)) best = i;
    });
    setHover(best);
  };
  const hoverT = hover !== null ? times[hover] : undefined;

  return (
    <div ref={wrap} className="relative w-full overflow-x-clip">
      {multi ? (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600" aria-hidden>
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="block h-auto max-w-full touch-none"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-neutral-200"
              strokeWidth={1}
            />
            <text
              x={pad.left - 8}
              y={y(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-neutral-500 text-[10px] tabular-nums"
            >
              {format(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={height - 6}
            textAnchor="middle"
            className="fill-neutral-500 text-[10px]"
          >
            {day(t)}
          </text>
        ))}
        {series.map((s) => {
          const all = [...s.points].sort((a, b) => a.t - b.t);
          // Split into runs of consecutive values; a null ends a run.
          const runs: Point[][] = [[]];
          for (const p of all) {
            if (p.v === null) runs.push([]);
            else runs[runs.length - 1]!.push(p as Point);
          }
          const segments = runs.filter((r) => r.length > 0);
          if (segments.length === 0) return null;
          const d = segments
            .filter((r) => r.length > 1)
            .map((r) =>
              r.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(""),
            )
            .join("");
          const lone = segments.filter((r) => r.length === 1).map((r) => r[0]!);
          const last = segments[segments.length - 1]!.at(-1)!;
          return (
            <g key={s.id}>
              {d ? (
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {lone.map((p) => (
                <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={3.5} fill={s.color} />
              ))}
              {multi ? (
                <text
                  x={x(last.t) + 8}
                  y={y(last.v)}
                  dy="0.32em"
                  className="fill-neutral-700 text-[10px] font-medium"
                >
                  {s.shortLabel ?? s.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {hoverT !== undefined ? (
          <g pointerEvents="none">
            <line
              x1={x(hoverT)}
              x2={x(hoverT)}
              y1={pad.top}
              y2={height - pad.bottom}
              className="stroke-neutral-400"
              strokeDasharray="3 3"
            />
            {series.map((s) => {
              const p = defined(s.points).find((q) => q.t === hoverT);
              return p ? (
                <circle
                  key={s.id}
                  cx={x(p.t)}
                  cy={y(p.v)}
                  r={4.5}
                  fill={s.color}
                  className="stroke-surface"
                  strokeWidth={2}
                />
              ) : null;
            })}
          </g>
        ) : null}
      </svg>
      {hoverT !== undefined ? (
        <div
          className="panel pointer-events-none absolute z-10 min-w-36 px-3 py-2 text-xs"
          style={{
            left: Math.min(x(hoverT) + 12, width - 170),
            top: multi ? 28 : 4,
          }}
        >
          <p className="mb-1 font-medium text-neutral-700">{day(hoverT)}</p>
          {series.map((s) => {
            const p = defined(s.points).find((q) => q.t === hoverT);
            return p ? (
              <p key={s.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-neutral-600">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums text-neutral-900">{format(p.v)}</span>
              </p>
            ) : null;
          })}
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Date</th>
            {series.map((s) => (
              <th key={s.id}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((t) => (
            <tr key={t}>
              <td>{day(t)}</td>
              {series.map((s) => {
                const p = defined(s.points).find((q) => q.t === t);
                return <td key={s.id}>{p ? format(p.v) : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
