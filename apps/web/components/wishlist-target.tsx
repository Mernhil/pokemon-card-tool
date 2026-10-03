"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setWishlistTargetAction } from "../app/wishlist/actions";
import { useToast } from "./ui/toast";

/** "Tell me under €X" under a wishlist tile; empty clears it. */
export function WishlistTarget({
  printingId,
  targetEur,
}: {
  printingId: string;
  /** Current target in euros (major units), or null. */
  targetEur: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(targetEur === null ? "" : String(targetEur));

  const save = async () => {
    const trimmed = value.trim().replace(",", ".");
    const next = trimmed === "" ? null : Number(trimmed);
    if (next === targetEur) return;
    const result = await setWishlistTargetAction(printingId, next);
    if (!result.ok) return toast("error", result.error);
    toast("success", next === null ? "Target removed" : `Watching for a listing under €${next}`);
    router.refresh();
  };

  return (
    <label className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-neutral-500">
      Deal under €
      <input
        type="text"
        inputMode="decimal"
        className="field w-16 py-0.5 text-xs"
        value={value}
        placeholder="—"
        aria-label="Target price in euros"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
