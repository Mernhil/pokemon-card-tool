/**
 * V = P_NM(variant) * m_condition * m_language
 * Starting multipliers; recalibrated per game and price band weekly from
 * CardTrader listings where the same blueprint is listed in several conditions.
 */
export const DEFAULT_CONDITION_MULTIPLIERS: Record<string, number> = {
  MINT: 1.05,
  NEAR_MINT: 1.0,
  LIGHTLY_PLAYED: 0.85,
  MODERATELY_PLAYED: 0.7,
  HEAVILY_PLAYED: 0.5,
  DAMAGED: 0.3,
};

export function derivedValue(
  nearMintValue: number,
  condition: string,
  languageMultiplier = 1,
  multipliers: Record<string, number> = DEFAULT_CONDITION_MULTIPLIERS,
): number {
  const m = multipliers[condition as string] ?? 1;
  return Math.round(nearMintValue * m * languageMultiplier);
}
