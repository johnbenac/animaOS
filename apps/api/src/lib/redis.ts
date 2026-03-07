// Redis connection config for BullMQ.
// BullMQ bundles its own ioredis — we just provide the config object.

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}

export const redisConnection = {
  ...parseRedisUrl(REDIS_URL),
  maxRetriesPerRequest: null as null, // required by BullMQ
};
