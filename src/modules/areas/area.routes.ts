import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { deliveryOrAdmin } from '../../shared/middleware/deliveryOrAdmin.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  createAreaController,
  deleteAreaController,
  getAreaController,
  listAgentsController,
  listAreaCustomersController,
  listAreasController,
  updateAreaController,
  updateAreaCustomersController,
} from './area.controller.js';
import {
  areaCustomersQuerySchema,
  areaIdParamSchema,
  areaListQuerySchema,
  assignCustomersSchema,
  createAreaSchema,
  updateAreaSchema,
} from './area.schema.js';

export const areaRoutes = new Hono<HonoEnv>();

areaRoutes.get('/', auth, tenant, deliveryOrAdmin, validateQuery(areaListQuerySchema), listAreasController);
areaRoutes.post('/', auth, tenant, adminOnly, validateBody(createAreaSchema), createAreaController);

// Static route must be defined BEFORE /:id so "agents" isn't captured as an id.
areaRoutes.get(
  '/agents',
  auth,
  tenant,
  adminOnly,
  validateQuery(areaListQuerySchema),
  listAgentsController,
);

areaRoutes.get(
  '/:id',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(areaIdParamSchema),
  getAreaController,
);
areaRoutes.put(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(areaIdParamSchema),
  validateBody(updateAreaSchema),
  updateAreaController,
);
areaRoutes.delete(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(areaIdParamSchema),
  deleteAreaController,
);

areaRoutes.get(
  '/:id/customers',
  auth,
  tenant,
  adminOnly,
  validateParams(areaIdParamSchema),
  validateQuery(areaCustomersQuerySchema),
  listAreaCustomersController,
);
areaRoutes.put(
  '/:id/customers',
  auth,
  tenant,
  adminOnly,
  validateParams(areaIdParamSchema),
  validateBody(assignCustomersSchema),
  updateAreaCustomersController,
);
