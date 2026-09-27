import { mediaUrl } from "@tcg-vault/shared/src/media-url";
import type { CSSProperties } from "react";

/**
 * A closed binder, drawn in CSS: leather cover in the binder's colour, spine
 * with ring bumps, stitching, a gold-foil name plate and a window showing its
 * best card. Hovering (on the parent .binder-shelf-item) swings the cover open
 * a little to show the pages inside (globals.css, "Binder cover").
 */
export function BinderCover({
  name,
  color,
  coverImageKey,
  size = "md",
}: {
  name: string;
  color: string;
  coverImageKey: string | null;
  size?: "md" | "lg";
}) {
  return (
    <div
      className={`binder-book ${size === "lg" ? "binder-book--lg" : ""}`}
      style={{ "--binder-color": color } as CSSProperties}
    >
      <div className="binder-book__pages" aria-hidden />
      <div className="binder-book__cover">
        <div className="binder-book__spine" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="binder-book__stitch" aria-hidden />
        <div className="binder-book__window">
          {coverImageKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(coverImageKey)} alt="" draggable={false} />
          ) : (
            <div className="binder-book__window-empty">TCG</div>
          )}
        </div>
        <div className="binder-book__plate">
          <span className="text-foil">{name}</span>
        </div>
      </div>
    </div>
  );
}
