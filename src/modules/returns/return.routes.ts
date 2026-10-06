import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { idempotency } from '../../shared/middleware/idempotency.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  adminListReturnsController,
  createReturnController,
  myReturnsController,
  updateReturnStatusController,
} from './return.controller.js';
import {
  createReturnSchema,
  returnIdParamSchema,
  returnListQuerySchema,
  updateReturnStatusSchema,
} from './return.schema.js';

export const returnRoutes = new Hono<HonoEnv>();

returnRoutes.post('/', auth, tenant, idempotency, validateBody(createReturnSchema), createReturnController);
returnRoutes.get('/my', auth, tenant, validateQuery(returnListQuerySchema), myReturnsController);
returnRoutes.get(
  '/admin/all',
  auth,
  tenant,
  adminOnly,
  validateQuery(returnListQuerySchema),
  adminListReturnsController,
);
returnRoutes.put(
  '/admin/:id/status',
  auth,
  tenant,
  adminOnly,
  idempotency,
  validateParams(returnIdParamSchema),
  validateBody(updateReturnStatusSchema),
  updateReturnStatusController,
);
