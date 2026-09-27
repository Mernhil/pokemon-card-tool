import IORedis from "ioredis";

// BullMQ requires this exact setting - it disables ioredis's own retry
// limit so BullMQ's blocking commands can retry indefinitely instead of
// throwing.
export function createRedisConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}
