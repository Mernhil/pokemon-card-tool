import Link from "next/link";
import { CompletionRing } from "./ui/completion-ring";

export interface SetTileData {
  id: number;
  code: string;
  name: string;
  logoUrl: string | null;
  releaseYear: number | null;
  cards: number;
  owned: number;
  /** Short label for special sets ("Promo", "Pocket"); null for main sets. */
  badge?: string | null;
}

/** One set on the game page: logo, name, year, card count and a completion ring. */
export function SetTile({ game, set }: { game: string; set: SetTileData }) {
  return (
    <Link
      href={`/${game}/${encodeURIComponent(set.code)}`}
      className="panel card-tile flex h-full flex-col gap-3 p-4"
    >
      <div className="flex h-16 items-center justify-center">
        {set.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={set.logoUrl}
            alt=""
            loading="lazy"
            className="max-h-16 max-w-full object-contain drop-shadow"
          />
        ) : (
          <span className="font-display text-xl font-semibold text-neutral-400">{set.name}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{set.name}</p>
          <p className="text-xs text-neutral-500">
            {set.releaseYear ?? "—"} · {set.cards} cards
            {set.badge ? (
              <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                {set.badge}
              </span>
            ) : null}
          </p>
        </div>
        <CompletionRing owned={set.owned} total={set.cards} />
      </div>
    </Link>
  );
}
