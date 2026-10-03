"use server";

import { createGoal, deleteGoal, type GoalFilter } from "@tcg-vault/db";
import { revalidatePath } from "next/cache";

export async function createGoalAction(
  name: string,
  filter: GoalFilter,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createGoal(name, filter);
    revalidatePath("/goals");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGoalAction(id: string): Promise<{ ok: boolean }> {
  try {
    await deleteGoal(id);
    revalidatePath("/goals");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
