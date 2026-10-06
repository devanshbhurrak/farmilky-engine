import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { idempotency } from '../../shared/middleware/idempotency.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  deletePaymentController,
  myPassbookController,
  recordPaymentController,
  updatePaymentController,
  userPassbookController,
} from './payment.controller.js';
import {
  deletePaymentSchema,
  passbookQuerySchema,
  paymentIdParamSchema,
  paymentUserParamSchema,
  recordPaymentSchema,
  updatePaymentSchema,
} from './payment.schema.js';

export const paymentRoutes = new Hono<HonoEnv>();

// Recording a payment is allowed for admins and delivery partners.
const adminOrDeliveryPartner = createMiddleware<HonoEnv>(async (c, next) => {
  const role = c.get('user').role;
  if (role !== 'admin' && role !== 'delivery_partner') {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  await next();
});

paymentRoutes.get('/my-passbook', auth, tenant, validateQuery(passbookQuerySchema), myPassbookController);
// '/:userId' is registered AFTER '/my-passbook' so the static route is not shadowed.
paymentRoutes.get(
  '/:userId',
  auth,
  tenant,
  adminOnly,
  validateParams(paymentUserParamSchema),
  validateQuery(passbookQuerySchema),
  userPassbookController,
);
paymentRoutes.post(
  '/admin/record',
  auth,
  tenant,
  adminOrDeliveryPartner,
  idempotency,
  validateBody(recordPaymentSchema),
  recordPaymentController,
);
paymentRoutes.put(
  '/admin/:id',
  auth,
  tenant,
  adminOnly,
  idempotency,
  validateParams(paymentIdParamSchema),
  validateBody(updatePaymentSchema),
  updatePaymentController,
);
paymentRoutes.delete(
  '/admin/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(paymentIdParamSchema),
  validateBody(deletePaymentSchema),
  deletePaymentController,
);
