import { mediaUrl } from "@tcg-vault/shared/src/media-url";

/**
 * A card's scan, or — when the source has no image for it yet (common for
 * sets released in the last few weeks; the sync retries every time) — a
 * card-shaped placeholder that still says which card it is.
 */
export function CardImage({
  imageKey,
  name,
  number,
  size = "grid",
  className = "",
}: {
  imageKey: string | null;
  name: string;
  number?: string;
  size?: "thumb" | "grid" | "large";
  className?: string;
}) {
  const box = size === "thumb" ? "h-16 w-[46px]" : size === "large" ? "w-full" : "w-full";
  if (imageKey) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={mediaUrl(imageKey)}
        alt={name}
        loading={size === "grid" ? "lazy" : undefined}
        className={`${box} aspect-[5/7] rounded object-cover ${className}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`${name} — image not available yet`}
      title="The source doesn't have an image for this card yet. Every sync checks again."
      className={`${box} flex aspect-[5/7] flex-col items-center justify-center gap-1 rounded border-4 border-amber-200 dark:border-amber-900 bg-gradient-to-br from-neutral-50 to-neutral-200 p-2 text-center ${className}`}
    >
      {size === "thumb" ? (
        <span className="text-[9px] leading-tight text-neutral-500">No image</span>
      ) : (
        <>
          <span className="text-sm font-semibold leading-tight text-neutral-700">{name}</span>
          {number ? <span className="text-xs text-neutral-500">{number}</span> : null}
          <span className="mt-2 text-[10px] uppercase tracking-wide text-neutral-400">
            Image not available yet
          </span>
        </>
      )}
    </div>
  );
}
