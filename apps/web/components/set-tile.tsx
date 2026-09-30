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

/** Base hue per game, so fallback tiles read as "this game" at a glance. */
const GAME_HUES: Record<string, number> = { pokemon: 45, yugioh: 270, "one-piece": 350 };

/** Deterministic: the same set always gets the same tile. */
export function fallbackTileStyle(game: string, code: string): { background: string } {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = GAME_HUES[game] ?? 210;
  const a = (base + (h % 40) - 20 + 360) % 360;
  const b = (a + 25) % 360;
  return { background: `linear-gradient(135deg, hsl(${a} 60% 40%), hsl(${b} 65% 26%))` };
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
          <div
            aria-hidden
            style={fallbackTileStyle(game, set.code)}
            className="flex h-16 w-full flex-col items-center justify-center overflow-hidden rounded-md px-2 text-center text-white shadow-inner"
          >
            <span className="font-display text-lg font-semibold leading-none">{set.code}</span>
            <span className="mt-1 line-clamp-1 w-full text-[10px] leading-tight opacity-85">
              {set.name}
            </span>
          </div>
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
