"use server";

import { revalidatePath } from "next/cache";
import {
  addBinderPages,
  createBinder,
  createBinderFromSet,
  deleteBinder,
  movePocket,
  placeCard,
  removeFromPocket,
  searchVariants,
  setPocketWant,
  trimEmptyBinderPages,
  updateBinder,
} from "@tcg-vault/db";

/** Every action returns this instead of throwing, so the UI can toast the reason. */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(binderId: string | null, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath("/binders");
    if (binderId) revalidatePath(`/binders/${binderId}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createBinderAction(input: {
  name: string;
  color: string;
  rows: number;
  cols: number;
  pages: number;
  setId: number | null;
}): Promise<ActionResult<string>> {
  return run(null, () =>
    input.setId ? createBinderFromSet({ ...input, setId: input.setId }) : createBinder(input),
  );
}

export async function updateBinderAction(id: string, data: { name?: string; color?: string }) {
  return run(id, () => updateBinder(id, data));
}

export async function deleteBinderAction(id: string) {
  return run(id, () => deleteBinder(id));
}

export async function addPagesAction(id: string) {
  return run(id, () => addBinderPages(id, 2));
}

export async function trimPagesAction(id: string) {
  return run(id, () => trimEmptyBinderPages(id));
}

export async function placeCardAction(
  binderId: string,
  pageIndex: number,
  position: number,
  collectionItemId: string,
) {
  return run(binderId, () => placeCard({ binderId, pageIndex, position, collectionItemId }));
}

export async function movePocketAction(
  binderId: string,
  from: { pageIndex: number; position: number },
  to: { pageIndex: number; position: number },
) {
  return run(binderId, () => movePocket({ binderId, from, to }));
}

export async function removeFromPocketAction(
  binderId: string,
  pageIndex: number,
  position: number,
) {
  return run(binderId, () => removeFromPocket({ binderId, pageIndex, position }));
}

export async function setWantAction(
  binderId: string,
  pageIndex: number,
  position: number,
  variantId: string | null,
) {
  return run(binderId, () => setPocketWant({ binderId, pageIndex, position, variantId }));
}

export async function searchVariantsAction(query: string) {
  return searchVariants(query);
}
