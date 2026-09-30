"use client";

import { X } from "lucide-react";
import { useTransition } from "react";
import { toggleWishlistAction } from "../app/wishlist/actions";

/** Small "x" over a wishlist tile. */
export function WishlistRemove({ printingId, cardName }: { printingId: string; cardName: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${cardName} from wishlist`}
      title="Remove from wishlist"
      onClick={() => start(async () => void (await toggleWishlistAction(printingId)))}
      className="absolute left-1 top-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
