import { snapshotPortfolio } from "@tcg-vault/db";

/** Daily PortfolioSnapshot row for the dashboard — see packages/db/src/valuations.ts. */
export async function snapshotPortfolios(): Promise<void> {
  await snapshotPortfolio();
}
