import { createMiddleware } from 'hono/factory';
import type { HonoEnv } from '../types/index.js';

export const adminOnly = createMiddleware<HonoEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, message: 'Unauthorized' }, 401);
  if (user.role !== 'admin') {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  await next();
});
