"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { deleteGoalAction } from "./actions";

export function DeleteGoalButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      title={`Delete the goal "${name}"`}
      aria-label={`Delete the goal ${name}`}
      className="text-neutral-400 hover:text-red-600"
      onClick={async () => {
        if (!window.confirm(`Delete the goal "${name}"? Your cards are not affected.`)) return;
        await deleteGoalAction(id);
        router.refresh();
      }}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
