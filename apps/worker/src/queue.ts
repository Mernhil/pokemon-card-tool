import { Queue } from "bullmq";
import IORedis from "ioredis";

export const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const catalogQueue = new Queue("catalog-sync", { connection });
export const priceQueue = new Queue("price-sync", { connection });
export const valuationQueue = new Queue("valuation", { connection });
export const portfolioQueue = new Queue("portfolio-snapshot", { connection });
export const searchQueue = new Queue("search-reindex", { connection });
