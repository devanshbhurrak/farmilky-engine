import { createMiddleware } from 'hono/factory';
import type { HonoEnv } from '../types/index.js';

export const adminOnly = createMiddleware<HonoEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  await next();
});
