import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CountUp } from "./count-up";

export function StatTile({
  label,
  value,
  format,
  display,
  sub,
  icon: Icon,
  highlight = false,
}: {
  label: string;
  /** Numeric value to count up to (minor units for "eur"). */
  value?: number;
  format?: "eur" | "int";
  /** Or a pre-formatted string instead of a counted number. */
  display?: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  highlight?: boolean;
}) {
  return (
    <div className={`panel p-5 ${highlight ? "holo-border" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
          {label}
        </p>
        {Icon ? <Icon className="h-4 w-4 text-neutral-400" strokeWidth={1.8} /> : null}
      </div>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${
          highlight ? "text-foil" : "text-neutral-950"
        }`}
      >
        {display ??
          (value !== undefined && format ? <CountUp value={value} format={format} /> : "—")}
      </p>
      {sub ? <p className="mt-1.5 text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}
