/**
 * Optional Redis-backed store for express-rate-limit.
 * Without REDIS_URL (or if ioredis is missing), callers should omit `store`
 * so express-rate-limit uses its default in-memory store.
 *
 * Install for multi-instance: npm i ioredis
 */

function createRedisStore(windowMs) {
  const redisUrl = (process.env.REDIS_URL || '').trim();
  if (!redisUrl) return null;

  let Redis;
  try {
    Redis = require('ioredis');
  } catch (_) {
    console.warn('REDIS_URL is set but ioredis is not installed. Using in-memory rate limits.');
    return null;
  }

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false
  });

  client.on('error', (err) => {
    console.warn('Redis rate-limit error:', err.message);
  });

  const prefix = process.env.REDIS_PREFIX || 'mgl:rl:';
  const ttlSec = Math.max(1, Math.ceil((windowMs || 60_000) / 1000));

  return {
    async increment(key) {
      const redisKey = prefix + key;
      const totalHits = await client.incr(redisKey);
      if (totalHits === 1) await client.expire(redisKey, ttlSec);
      const ttl = await client.pttl(redisKey);
      return {
        totalHits,
        resetTime: new Date(Date.now() + Math.max(ttl, 0))
      };
    },
    async decrement(key) {
      try { await client.decr(prefix + key); } catch (_) {}
    },
    async resetKey(key) {
      try { await client.del(prefix + key); } catch (_) {}
    },
    shutdown() {
      try { client.disconnect(); } catch (_) {}
    }
  };
}

module.exports = { createRedisStore };
