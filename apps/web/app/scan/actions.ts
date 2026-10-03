"use server";

import { findScanCandidates, type ScanCandidate } from "@tcg-vault/db";
import { parseScannedNumbers, type ScannedNumber } from "@tcg-vault/shared";

export interface ScanLookup {
  numbers: ScannedNumber[];
  candidates: ScanCandidate[];
}

/** OCR text (or a number typed by hand) -> the cards it could be. */
export async function lookupScanAction(text: string): Promise<ScanLookup> {
  const numbers = parseScannedNumbers(text.slice(0, 2_000));
  return { numbers, candidates: numbers.length ? await findScanCandidates(numbers) : [] };
}
