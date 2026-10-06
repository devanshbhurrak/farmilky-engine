import { createMiddleware } from 'hono/factory';
import type { HonoEnv } from '../types/index.js';

const ALLOWED = new Set(['admin', 'delivery', 'delivery_partner', 'agent']);

export const deliveryOrAdmin = createMiddleware<HonoEnv>(async (c, next) => {
  if (!ALLOWED.has(c.get('user').role)) {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  await next();
});
