import { Check } from "lucide-react";
import Link from "next/link";
import { CardImage } from "./card-image";
import { FinishBadge, PriceChip } from "./money";

/**
 * A card in a grid: image with hover lift, name, number/rarity, finish
 * badges and price. `owned` puts a gold check on it; `dimmed` greys it out
 * (e.g. cards you're missing from a set).
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
}) {
  return (
    <Link
      href={href}
      className={`card-tile panel group relative flex h-full flex-col gap-1.5 p-2 text-center ${
        dimmed ? "opacity-55 saturate-[0.35] hover:opacity-100 hover:saturate-100" : ""
      } ${owned > 0 ? "ring-1 ring-accent/50" : ""}`}
    >
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
    </Link>
  );
}
