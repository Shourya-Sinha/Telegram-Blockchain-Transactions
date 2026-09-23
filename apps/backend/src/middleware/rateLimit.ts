import type { RequestHandler } from 'express';
import { redis } from '../lib/redis';
import { config } from '../config';

export function rateLimit(scope: string, limit = config.rateLimitPerMinute): RequestHandler {
  return async (req, res, next) => {
    const identity = req.telegramUser?.telegramId.toString() ?? req.ip ?? 'anonymous';
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `rate:${scope}:${identity}:${bucket}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 61);
      if (count > limit) {
        res.status(429).json({ error: 'Too many requests. Please try again shortly.', code: 'RATE_LIMITED' });
        return;
      }
      next();
    } catch (error) {
      console.error('[rate-limit]', error);
      // Availability is preferred for read-only endpoints when Redis is recovering.
      next();
    }
  };
}
