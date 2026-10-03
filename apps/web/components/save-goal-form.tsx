"use client";

import type { GoalFilter } from "@tcg-vault/db";
import Link from "next/link";
import { useState } from "react";
import { createGoalAction } from "../app/goals/actions";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

/** "Save this search as a goal" on the Search page: a name, then a progress bar on /goals. */
export function SaveGoalForm({ filter, suggestion }: { filter: GoalFilter; suggestion: string }) {
  const toast = useToast();
  const [name, setName] = useState(suggestion);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const result = await createGoalAction(name, filter);
    setBusy(false);
    if (!result.ok) return toast("error", result.error);
    setSaved(true);
    toast("success", "Goal saved");
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2 text-xs text-neutral-500">
        Save as a goal
        <input
          className="field w-56 py-1 text-sm"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          aria-label="Goal name"
        />
      </label>
      <Button size="sm" variant="secondary" disabled={busy || saved || !name.trim()} onClick={() => void save()}>
        {saved ? "Saved" : "Save goal"}
      </Button>
      {saved ? (
        <Link href="/goals" className="text-xs text-accent hover:underline">
          See your goals
        </Link>
      ) : null}
    </div>
  );
}
