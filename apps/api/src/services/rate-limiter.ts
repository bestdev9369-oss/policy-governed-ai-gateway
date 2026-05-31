import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Sliding-window rate limiter backed by Redis.
 *
 * Uses the sorted set pattern: each request adds a member with score=timestamp,
 * then we count members within the window. This gives a true sliding window
 * (not a fixed bucket) which is fairer for API clients.
 *
 * Key format: rl:{tenantId}:{endpoint}
 * TTL is set to windowMs to auto-clean Redis keys.
 */

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10),
  max: parseInt(process.env['RATE_LIMIT_MAX'] ?? '100', 10),
};

export async function checkRateLimit(
  redis: { zadd: Function; zcount: Function; expire: Function; zremrangebyscore: Function } | null,
  tenantId: string,
  endpoint: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  // If Redis is unavailable, fail-open (allow) — log in production
  if (!redis) {
    return { allowed: true, remaining: config.max, resetAt: Date.now() + config.windowMs };
  }

  const key = `rl:${tenantId}:${endpoint}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const resetAt = now + config.windowMs;

  try {
    // Remove expired entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count requests in window
    const count = (await redis.zcount(key, windowStart, now)) as number;

    if (count >= config.max) {
      return { allowed: false, remaining: 0, resetAt };
    }

    // Record this request
    await redis.zadd(key, now, `${now}-${Math.random()}`);
    await redis.expire(key, Math.ceil(config.windowMs / 1000));

    return { allowed: true, remaining: config.max - count - 1, resetAt };
  } catch {
    // Redis error → fail-open
    return { allowed: true, remaining: config.max, resetAt };
  }
}

export function rateLimitHeaders(
  reply: FastifyReply,
  remaining: number,
  resetAt: number,
  max: number,
) {
  reply.header('X-RateLimit-Limit', max);
  reply.header('X-RateLimit-Remaining', remaining);
  reply.header('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
}
