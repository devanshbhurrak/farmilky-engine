import { createMiddleware } from 'hono/factory';
import type { HonoEnv } from '../types/index.js';

const ALLOWED = new Set(['admin', 'delivery', 'delivery_partner', 'agent']);

export const deliveryOrAdmin = createMiddleware<HonoEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, message: 'Unauthorized' }, 401);
  if (!ALLOWED.has(user.role)) {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  await next();
});
