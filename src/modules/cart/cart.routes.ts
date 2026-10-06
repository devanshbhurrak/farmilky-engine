import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  addItemController,
  clearCartController,
  getCartController,
  removeItemController,
  updateItemController,
} from './cart.controller.js';
import {
  addItemSchema,
  removeParamsSchema,
  removeQuerySchema,
  updateItemSchema,
} from './cart.schema.js';

const customerOrAdmin = createMiddleware<HonoEnv>(async (c, next) => {
  const role = c.get('user').role;
  if (role !== 'customer' && role !== 'admin') {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  await next();
});

export const cartRoutes = new Hono<HonoEnv>();

cartRoutes.get('/', auth, tenant, customerOrAdmin, getCartController);
cartRoutes.post('/add', auth, tenant, customerOrAdmin, validateBody(addItemSchema), addItemController);
cartRoutes.put('/update', auth, tenant, customerOrAdmin, validateBody(updateItemSchema), updateItemController);
cartRoutes.delete(
  '/remove/:productId',
  auth,
  tenant,
  customerOrAdmin,
  validateParams(removeParamsSchema),
  validateQuery(removeQuerySchema),
  removeItemController,
);
cartRoutes.delete('/clear', auth, tenant, customerOrAdmin, clearCartController);
