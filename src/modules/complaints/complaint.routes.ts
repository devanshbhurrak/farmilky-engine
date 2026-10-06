import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { idempotency } from '../../shared/middleware/idempotency.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  adminListComplaintsController,
  createComplaintController,
  getComplaintController,
  listMyComplaintsController,
  updateComplaintStatusController,
} from './complaint.controller.js';
import {
  complaintIdParamSchema,
  complaintListQuerySchema,
  createComplaintSchema,
  updateComplaintStatusSchema,
} from './complaint.schema.js';

export const complaintRoutes = new Hono<HonoEnv>();

complaintRoutes.post('/', auth, tenant, idempotency, validateBody(createComplaintSchema), createComplaintController);
complaintRoutes.get('/', auth, tenant, validateQuery(complaintListQuerySchema), listMyComplaintsController);
// Static admin route must be registered before '/:id' so it is not shadowed.
complaintRoutes.get(
  '/admin/all',
  auth,
  tenant,
  adminOnly,
  validateQuery(complaintListQuerySchema),
  adminListComplaintsController,
);
complaintRoutes.get('/:id', auth, tenant, validateParams(complaintIdParamSchema), getComplaintController);
complaintRoutes.put(
  '/admin/:id/status',
  auth,
  tenant,
  adminOnly,
  idempotency,
  validateParams(complaintIdParamSchema),
  validateBody(updateComplaintStatusSchema),
  updateComplaintStatusController,
);
