"use client";

import { Heart } from "lucide-react";
import { useState, useTransition } from "react";
import { toggleWishlistAction } from "../app/wishlist/actions";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

/** Heart toggle: adds the card to / removes it from the wishlist. */
export function WishlistButton({
  printingId,
  initial,
  cardName,
}: {
  printingId: string;
  initial: boolean;
  cardName: string;
}) {
  const [wishlisted, setWishlisted] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      aria-pressed={wishlisted}
      onClick={() =>
        start(async () => {
          const r = await toggleWishlistAction(printingId);
          setWishlisted(r.wishlisted);
          toast("success", r.wishlisted ? `${cardName} added to wishlist` : "Removed from wishlist");
        })
      }
    >
      <Heart
        className={`h-4 w-4 ${wishlisted ? "fill-accent text-accent" : ""}`}
        strokeWidth={1.8}
      />
      {wishlisted ? "On wishlist" : "Wishlist"}
    </Button>
  );
}
