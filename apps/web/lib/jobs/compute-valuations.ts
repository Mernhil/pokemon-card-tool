import { computeValuations as compute } from "@tcg-vault/db";

/** See packages/db/src/valuations.ts. */
export async function computeValuations(): Promise<void> {
  await compute();
}
