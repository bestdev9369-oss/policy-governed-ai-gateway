import type { FastifyReply } from 'fastify';
import { logger } from '../logger.js';
import { metrics } from '../metrics.js';

/**
 * Sliding-window rate limiter backed by Redis.
 *
 * Uses the sorted set pattern: each request adds a member scored with the
 * current timestamp, then counts members within [now - windowMs, now].
 * This gives a true sliding window — fairer than fixed buckets.
 *
 * Key format: rl:{tenantId}:{endpoint}
 * TTL is set to windowMs to auto-expire idle keys.
 *
 * Failure mode: if Redis is unavailable the limiter FAILS OPEN (allows the
 * request) to avoid an infrastructure dependency becoming a gateway outage.
 * This is logged as a warning so on-call is notified. In high-security
 * deployments, change the catch branch to fail-closed.
 */

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10),
  max: parseInt(process.env['RATE_LIMIT_MAX'] ?? '100', 10),
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function checkRateLimit(
  redis: {
    zadd: (...args: unknown[]) => Promise<unknown>;
    zcount: (...args: unknown[]) => Promise<unknown>;
    expire: (...args: unknown[]) => Promise<unknown>;
    zremrangebyscore: (...args: unknown[]) => Promise<unknown>;
  } | null,
  tenantId: string,
  endpoint: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  if (!redis) {
    return { allowed: true, remaining: config.max, resetAt: Date.now() + config.windowMs };
  }

  const key = `rl:${tenantId}:${endpoint}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const resetAt = now + config.windowMs;

  try {
    // Remove entries that have fallen outside the window.
    // Use '-inf' as lower bound and (windowStart (exclusive) to avoid the
    // boundary entry being both removed and then counted.
    await redis.zremrangebyscore(key, '-inf', windowStart - 1);

    // Count requests currently within the window.
    const count = (await redis.zcount(key, windowStart, '+inf')) as number;

    if (count >= config.max) {
      return { allowed: false, remaining: 0, resetAt };
    }

    // Record this request with a unique member to handle same-millisecond bursts.
    await redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
    await redis.expire(key, Math.ceil(config.windowMs / 1000));

    return { allowed: true, remaining: config.max - count - 1, resetAt };
  } catch (err) {
    // Log so on-call is notified, then fail-open to avoid gateway outage.
    logger.warn('Rate limiter Redis error — failing open', {
      tenant: tenantId,
      endpoint,
      error: String(err),
    });
    metrics.incCounter('pgag_ratelimiter_errors_total', { tenant: tenantId });
    return { allowed: true, remaining: config.max, resetAt };
  }
}

/** Set standard rate-limit response headers (RFC 6585). */
export function applyRateLimitHeaders(
  reply: FastifyReply,
  result: RateLimitResult,
  max: number,
): void {
  reply.header('X-RateLimit-Limit', max);
  reply.header('X-RateLimit-Remaining', Math.max(0, result.remaining));
  reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
}
