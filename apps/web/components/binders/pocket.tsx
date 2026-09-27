"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { foilFor } from "@tcg-vault/card-fx";
import type { Pocket as PocketData } from "@tcg-vault/db/src/binder-types";
import { mediaUrl } from "@tcg-vault/shared/src/media-url";
import type { MouseEvent } from "react";

export const pocketDragId = (page: number, pos: number) => `pocket:${page}:${pos}`;
export const pocketDropId = (page: number, pos: number) => `drop:${page}:${pos}`;

const eur = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(minor / 100);

/**
 * One sleeve on a binder page. Shows the owned copy (with a hint of its
 * foil), or the wanted card greyed out, or an empty sleeve. It's a drop
 * target, and — when it holds something — draggable to move/swap it.
 */
export function Pocket({
  page,
  position,
  data,
  interactive,
  onOpen,
  onMenu,
}: {
  page: number;
  position: number;
  data: PocketData | undefined;
  /** False for pages mid-flip (not droppable/draggable while turning). */
  interactive: boolean;
  onOpen: (e: MouseEvent<HTMLElement>, page: number, position: number) => void;
  onMenu: (e: MouseEvent<HTMLElement>, page: number, position: number) => void;
}) {
  const filled = Boolean(data?.item || data?.want);
  const drop = useDroppable({
    id: pocketDropId(page, position),
    data: { type: "pocket", page, position },
    disabled: !interactive,
  });
  const drag = useDraggable({
    id: pocketDragId(page, position),
    data: { type: "pocket", page, position, pocket: data },
    disabled: !interactive || !filled,
  });

  const card = data?.item ?? data?.want ?? null;
  const isWant = !data?.item && Boolean(data?.want);
  const foil = data?.item ? foilFor(data.item.finish, data.item.rarity) : null;

  return (
    <div
      ref={drop.setNodeRef}
      className={`pocket ${drop.isOver ? "pocket--over" : ""} ${drag.isDragging ? "pocket--lifted" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e, page, position);
      }}
    >
      {card ? (
        <button
          ref={drag.setNodeRef}
          type="button"
          {...drag.listeners}
          {...drag.attributes}
          onClick={(e) => onOpen(e, page, position)}
          className={`pocket__card ${isWant ? "pocket__card--want" : ""}`}
          aria-label={`${card.name} ${card.number}${isWant ? " (wanted)" : ""}`}
          title={`${card.name} · ${card.number}${card.valueEur ? ` · ${eur(card.valueEur)}` : ""}`}
        >
          {card.imageKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(card.imageKey)} alt="" draggable={false} loading="lazy" />
          ) : (
            <span className="pocket__noimg">
              <strong>{card.name}</strong>
              <span>{card.number}</span>
            </span>
          )}
          {foil && foil.area !== "none" ? (
            <span className={`pocket__foil pocket__foil--${foil.area}`} aria-hidden />
          ) : null}
          {isWant ? (
            <span className="pocket__want-label">
              Missing{card.valueEur ? ` · ${eur(card.valueEur)}` : ""}
            </span>
          ) : null}
        </button>
      ) : (
        <span className="pocket__empty" aria-hidden>
          +
        </span>
      )}
      <span className="pocket__sleeve" aria-hidden />
    </div>
  );
}
