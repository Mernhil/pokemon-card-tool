"use client";

import { useEffect, useRef, useState } from "react";
import { mediaUrl, REMOTE_IMAGE_PREFIX } from "@tcg-vault/shared/src/media-url";

/**
 * A card's scan, or — when it can't be loaded — a card-shaped placeholder that
 * still says which card it is, with a tooltip explaining what was tried and
 * why it failed (asked of the media route only after the image failed).
 */
export function CardImage({
  imageKey,
  name,
  number,
  size = "grid",
  className = "",
  action,
}: {
  imageKey: string | null;
  name: string;
  number?: string;
  size?: "thumb" | "grid" | "large";
  className?: string;
  /** Shown inside the missing-image tile, e.g. a "Set custom image" button. */
  action?: React.ReactNode;
}) {
  const box = size === "thumb" ? "h-16 w-[46px]" : "w-full";
  const [failed, setFailed] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement>(null);
  const isLazyKey = !!imageKey && imageKey.startsWith(REMOTE_IMAGE_PREFIX);

  // An error that fired before hydration never reached onError.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  useEffect(() => {
    if (!failed || !imageKey || !isLazyKey) return;
    let cancelled = false;
    fetch(`${mediaUrl(imageKey)}?why=1`)
      .then((r) => r.json())
      .then((d: { reason?: string }) => {
        if (!cancelled && d.reason) setWhy(d.reason);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [failed, imageKey, isLazyKey]);

  if (imageKey && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref}
        src={isLazyKey ? `${mediaUrl(imageKey)}?strict=1` : mediaUrl(imageKey)}
        alt={name}
        loading={size === "grid" ? "lazy" : undefined}
        onError={() => setFailed(true)}
        className={`${box} aspect-[5/7] rounded object-cover ${className}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`${name} — image not available`}
      title={why ?? "No image is available for this card yet. Every sync checks again."}
      className={`${box} flex aspect-[5/7] flex-col items-center justify-center gap-1 rounded border-4 border-amber-200 dark:border-amber-900 bg-gradient-to-br from-neutral-50 to-neutral-200 p-2 text-center ${className}`}
    >
      {size === "thumb" ? (
        <span className="text-[9px] leading-tight text-neutral-500">No image</span>
      ) : (
        <>
          <span className="text-sm font-semibold leading-tight text-neutral-700">{name}</span>
          {number ? <span className="text-xs text-neutral-500">{number}</span> : null}
          <span className="mt-2 text-[10px] uppercase tracking-wide text-neutral-400">
            Image not available
          </span>
          {action}
        </>
      )}
    </div>
  );
}
