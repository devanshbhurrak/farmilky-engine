import { createMiddleware } from 'hono/factory';
import type { HonoEnv } from '../types/index.js';
import { getCache } from '../cache/index.js';

export const createLimiter = (max: number, windowMs: number) =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const forwarded = c.req.header('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const key = `rl:${c.req.path}:${ip}`;
    const count = await getCache().increment(key, windowMs / 1000);
    if (count > max) {
      return c.json({ success: false, message: 'Too many requests' }, 429);
    }
    await next();
  });
