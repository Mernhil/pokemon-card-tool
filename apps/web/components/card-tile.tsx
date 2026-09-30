import { Check, Minus, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CardImage } from "./card-image";
import { FinishBadge, PriceChip, finishLabel } from "./money";

/** One finish of a card in the quick add/remove overlay. */
export interface QuickAddRow {
  variantId: string;
  finish: string;
  /** Ungraded copies — the only ones the overlay can remove. */
  plain: number;
  /** All copies, graded included. */
  total: number;
}

export interface QuickAddControls {
  rows: QuickAddRow[];
  onAdjust: (variantId: string, delta: 1 | -1) => void;
}

const TILE_CLASS = "card-tile panel group relative flex h-full flex-col gap-1.5 p-2 text-center";

/**
 * A card in a grid: image with hover lift, name, number/rarity, finish
 * badges and price. `owned` puts a gold check on it; `dimmed` greys it out
 * (e.g. cards you're missing from a set). `quickAdd` opts in to a hover /
 * focus overlay with a - count + row per finish.
 */
export function CardTile({
  href,
  imageKey,
  name,
  number,
  subtitle,
  finishes = [],
  price,
  pricePrefix,
  owned = 0,
  dimmed = false,
  quickAdd,
}: {
  href: string;
  imageKey: string | null;
  name: string;
  number: string;
  subtitle?: string;
  finishes?: string[];
  price?: number | null;
  pricePrefix?: string;
  owned?: number;
  dimmed?: boolean;
  quickAdd?: QuickAddControls;
}) {
  const stateClass = `${
    dimmed ? "opacity-55 saturate-[0.35] hover:opacity-100 hover:saturate-100" : ""
  } ${owned > 0 ? "ring-1 ring-accent/50" : ""}`;

  const body: ReactNode = (
    <>
      <div className="card-tile__img overflow-hidden rounded-md">
        <CardImage imageKey={imageKey} name={name} number={number} />
      </div>
      {owned > 0 ? (
        <span
          className="absolute right-1 top-1 flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-fg shadow"
          title={`You own ${owned}`}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
          {owned > 1 ? owned : null}
        </span>
      ) : null}
      <span className="line-clamp-1 text-xs font-medium text-neutral-900">{name}</span>
      <span className="line-clamp-2 text-[11px] leading-tight text-neutral-500">
        {subtitle ?? number}
      </span>
      {finishes.some((f) => f !== "NON_FOIL") ? (
        <span className="flex flex-wrap justify-center gap-1">
          {finishes
            .filter((f) => f !== "NON_FOIL")
            .map((f) => (
              <FinishBadge key={f} finish={f} />
            ))}
        </span>
      ) : null}
      <span className="mt-auto pt-0.5">
        <PriceChip value={price} prefix={pricePrefix} />
      </span>
    </>
  );

  if (!quickAdd || quickAdd.rows.length === 0) {
    return (
      <Link href={href} className={`${TILE_CLASS} ${stateClass}`}>
        {body}
      </Link>
    );
  }

  // The controls are buttons, which can't live inside the <a>: the link and
  // the overlay are siblings, and the wrapper carries the tile's look (and
  // its hover lift) so both move together.
  return (
    <div className={`card-tile panel group relative h-full ${stateClass}`}>
      <Link href={href} className="flex h-full flex-col gap-1.5 rounded-[inherit] p-2 text-center">
        {body}
      </Link>
      <QuickAddOverlay name={name} quickAdd={quickAdd} />
    </div>
  );
}

/**
 * Sits over the bottom edge of the image (a box the size of the image: same
 * 5/7 ratio and the tile's 0.5rem padding). Revealed on hover and on keyboard
 * focus-within; the empty part of the box lets clicks through to the link.
 */
function QuickAddOverlay({ name, quickAdd }: { name: string; quickAdd: QuickAddControls }) {
  const multi = quickAdd.rows.length > 1;
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 flex aspect-[5/7] items-end justify-center p-1.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
      <div className="pointer-events-auto flex w-full select-none flex-col gap-0.5 rounded-lg bg-black/75 p-1 text-white shadow-lg backdrop-blur-sm">
        {quickAdd.rows.map((row) => {
          const label = finishLabel(row.finish);
          const canRemove = row.plain > 0;
          const gradedOnly = !canRemove && row.total > 0;
          const removeTitle = gradedOnly
            ? "Graded copies are managed on the card page"
            : canRemove
              ? `Remove one ${multi ? `${label} ` : ""}copy`
              : "No copies to remove";
          return (
            <div key={row.variantId} className="flex items-center gap-1">
              {multi ? (
                <span className="min-w-0 flex-1 truncate pl-1 text-left text-[10px] font-semibold leading-none">
                  {label}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <button
                type="button"
                aria-label={`Remove one ${multi ? `${label} ` : ""}copy of ${name}`}
                aria-disabled={!canRemove}
                title={removeTitle}
                onClick={() => canRemove && quickAdd.onAdjust(row.variantId, -1)}
                className={`flex h-5 w-5 items-center justify-center rounded bg-white/15 transition-colors ${
                  canRemove
                    ? "hover:bg-white/30 active:bg-white/40"
                    : "cursor-not-allowed opacity-40"
                }`}
              >
                <Minus className="h-3 w-3" strokeWidth={3} />
              </button>
              <span
                className="w-4 text-center text-xs font-semibold tabular-nums"
                aria-live="polite"
                aria-label={`${row.total} owned`}
              >
                {row.total}
              </span>
              <button
                type="button"
                aria-label={`Add one ${multi ? `${label} ` : ""}copy of ${name}`}
                title={`Add one ${multi ? `${label} ` : ""}copy`}
                onClick={() => quickAdd.onAdjust(row.variantId, 1)}
                className="flex h-5 w-5 items-center justify-center rounded bg-white/15 transition-colors hover:bg-white/30 active:bg-white/40"
              >
                <Plus className="h-3 w-3" strokeWidth={3} />
              </button>
              {multi ? null : <span className="flex-1" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
