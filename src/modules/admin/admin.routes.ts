import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  adminStatsController,
  deliveryPerformanceController,
  deliveryStatsController,
  profitStatsController,
} from './admin.controller.js';
import { deliveryPerformanceQuerySchema } from './admin.schema.js';
import { validateBody } from '../../shared/middleware/validate.js';
import {
  bulkPauseController,
  bulkResumeController,
} from '../subscriptions/subscription.controller.js';
import { bulkIdsSchema } from '../subscriptions/subscription.schema.js';

export const adminRoutes = new Hono<HonoEnv>();

adminRoutes.use('*', auth, tenant, adminOnly);

adminRoutes.get('/stats', adminStatsController);
adminRoutes.get('/delivery-stats', deliveryStatsController);
adminRoutes.get(
  '/delivery-performance',
  validateQuery(deliveryPerformanceQuerySchema),
  deliveryPerformanceController,
);
adminRoutes.get('/profit-stats', profitStatsController);

// Aliases required by the API contract: bulk pause/resume are also reachable
// via /api/admin/subscriptions/* (primary paths live under /api/subscriptions).
adminRoutes.put('/subscriptions/bulk-pause', validateBody(bulkIdsSchema), bulkPauseController);
adminRoutes.put('/subscriptions/bulk-resume', validateBody(bulkIdsSchema), bulkResumeController);
