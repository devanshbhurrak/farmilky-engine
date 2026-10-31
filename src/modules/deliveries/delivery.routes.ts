import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { deliveryOrAdmin } from '../../shared/middleware/deliveryOrAdmin.js';
import { idempotency } from '../../shared/middleware/idempotency.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  cancelDeliveryController,
  confirmUnconfirmedDeliveriesController,
  correctDeliveryController,
  customerDeliverySummaryController,
  getDeliveryController,
  listDeliveriesController,
  markMissedDeliveriesController,
  recordDeliveryOutcomeController,
  recordPaymentController,
  rescheduleDeliveryController,
  unconfirmedDeliveriesController,
  getSessionStateController,
} from './delivery.controller.js';
import {
  cancelDeliverySchema,
  confirmUnconfirmedDeliveriesSchema,
  correctDeliveryBodySchema,
  deliveryIdParamSchema,
  deliveryQuerySchema,
  markMissedSchema,
  recordDeliveryOutcomeSchema,
  recordPaymentBodySchema,
  rescheduleDeliverySchema,
  sessionStateQuerySchema,
  unconfirmedDeliveriesQuerySchema,
} from './delivery.schema.js';

export const deliveryRoutes = new Hono<HonoEnv>();

// Admin / delivery-staff outcome recording for subscriptions, orders and
// instant/rush deliveries. Idempotent to prevent duplicate charges on retry.
deliveryRoutes.post(
  '/admin/outcome',
  auth,
  tenant,
  deliveryOrAdmin,
  idempotency,
  validateBody(recordDeliveryOutcomeSchema),
  recordDeliveryOutcomeController,
);

// Previous-days scheduled deliveries with no recorded outcome, and bulk
// confirmation of those rows.
deliveryRoutes.get(
  '/admin/unconfirmed',
  auth,
  tenant,
  deliveryOrAdmin,
  validateQuery(unconfirmedDeliveriesQuerySchema),
  unconfirmedDeliveriesController,
);

deliveryRoutes.post(
  '/admin/unconfirmed/confirm',
  auth,
  tenant,
  deliveryOrAdmin,
  validateBody(confirmUnconfirmedDeliveriesSchema),
  confirmUnconfirmedDeliveriesController,
);

// Correction of a historical delivery record (optimistic-locked).
deliveryRoutes.patch(
  '/admin/:id/correct',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(deliveryIdParamSchema),
  validateBody(correctDeliveryBodySchema),
  correctDeliveryController,
);

deliveryRoutes.post(
  '/admin/:id/reschedule',
  auth,
  tenant,
  deliveryOrAdmin,
  idempotency,
  validateParams(deliveryIdParamSchema),
  validateBody(rescheduleDeliverySchema),
  rescheduleDeliveryController,
);

deliveryRoutes.post(
  '/admin/:id/cancel',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(deliveryIdParamSchema),
  validateBody(cancelDeliverySchema),
  cancelDeliveryController,
);

// Payment against a specific delivery (full / partial / advance).
deliveryRoutes.post(
  '/admin/:id/payment',
  auth,
  tenant,
  deliveryOrAdmin,
  idempotency,
  validateParams(deliveryIdParamSchema),
  validateBody(recordPaymentBodySchema),
  recordPaymentController,
);

deliveryRoutes.get(
  '/admin/session-state',
  auth,
  tenant,
  deliveryOrAdmin,
  validateQuery(sessionStateQuerySchema),
  getSessionStateController,
);

deliveryRoutes.get(
  '/admin/:id',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(deliveryIdParamSchema),
  getDeliveryController,
);

deliveryRoutes.get(
  '/admin',
  auth,
  tenant,
  deliveryOrAdmin,
  validateQuery(deliveryQuerySchema),
  listDeliveriesController,
);

deliveryRoutes.get(
  '/admin/summary',
  auth,
  tenant,
  deliveryOrAdmin,
  validateQuery(deliveryQuerySchema),
  customerDeliverySummaryController,
);

// End-of-day: mark stale pending deliveries as missed.
deliveryRoutes.post(
  '/admin/mark-missed',
  auth,
  tenant,
  adminOnly,
  validateBody(markMissedSchema),
  markMissedDeliveriesController,
);
