import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { deliveryOrAdmin } from '../../shared/middleware/deliveryOrAdmin.js';
import { idempotency } from '../../shared/middleware/idempotency.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  adminCreateOrderController,
  adminGetOrderController,
  adminListOrdersController,
  adminUpdateOrderController,
  cancelOrderController,
  deliveryOutcomeController,
  getOrderController,
  instantDeliveryController,
  listMyOrdersController,
  placeOrderController,
  updateOrderStatusController,
} from './order.controller.js';
import {
  adminCreateOrderSchema,
  adminOrderListQuerySchema,
  cancelSchema,
  deliveryOutcomeSchema,
  instantDeliverySchema,
  orderIdParamSchema,
  orderListQuerySchema,
  orderStatusSchema,
  placeOrderSchema,
  updateOrderSchema,
} from './order.schema.js';

const customerOrAdmin = createMiddleware<HonoEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, message: 'Unauthorized' }, 401);
  if (user.role !== 'customer' && user.role !== 'admin') {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  await next();
});

export const orderRoutes = new Hono<HonoEnv>();

orderRoutes.post(
  '/admin/create',
  auth,
  tenant,
  adminOnly,
  validateBody(adminCreateOrderSchema),
  adminCreateOrderController,
);
orderRoutes.post(
  '/admin/instant-delivery',
  auth,
  tenant,
  adminOnly,
  idempotency,
  validateBody(instantDeliverySchema),
  instantDeliveryController,
);
orderRoutes.get(
  '/admin/all',
  auth,
  tenant,
  adminOnly,
  validateQuery(adminOrderListQuerySchema),
  adminListOrdersController,
);
orderRoutes.get(
  '/admin/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(orderIdParamSchema),
  adminGetOrderController,
);
orderRoutes.put(
  '/admin/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(orderIdParamSchema),
  validateBody(updateOrderSchema),
  adminUpdateOrderController,
);
orderRoutes.put(
  '/admin/:id/status',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(orderIdParamSchema),
  validateBody(orderStatusSchema),
  updateOrderStatusController,
);
orderRoutes.post(
  '/admin/:id/delivery-outcome',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(orderIdParamSchema),
  validateBody(deliveryOutcomeSchema),
  deliveryOutcomeController,
);

orderRoutes.post(
  '/',
  auth,
  tenant,
  customerOrAdmin,
  idempotency,
  validateBody(placeOrderSchema),
  placeOrderController,
);
orderRoutes.get(
  '/',
  auth,
  tenant,
  customerOrAdmin,
  validateQuery(orderListQuerySchema),
  listMyOrdersController,
);
orderRoutes.get(
  '/:id',
  auth,
  tenant,
  customerOrAdmin,
  validateParams(orderIdParamSchema),
  getOrderController,
);
orderRoutes.put(
  '/:id/cancel',
  auth,
  tenant,
  customerOrAdmin,
  validateParams(orderIdParamSchema),
  validateBody(cancelSchema),
  cancelOrderController,
);
