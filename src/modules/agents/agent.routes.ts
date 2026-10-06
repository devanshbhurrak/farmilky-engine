import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  assignAgentAreaController,
  createAgentController,
  getAgentController,
  getAgentPerformanceController,
  listAgentsController,
  removeAgentController,
  setAgentStatusController,
  updateAgentController,
} from './agent.controller.js';
import {
  agentIdParamSchema,
  agentListQuerySchema,
  agentPerformanceQuerySchema,
  agentStatusSchema,
  assignAreaSchema,
  createAgentSchema,
  updateAgentSchema,
} from './agent.schema.js';

export const agentRoutes = new Hono<HonoEnv>();

agentRoutes.get(
  '/',
  auth,
  tenant,
  adminOnly,
  validateQuery(agentListQuerySchema),
  listAgentsController,
);
agentRoutes.post('/', auth, tenant, adminOnly, validateBody(createAgentSchema), createAgentController);
agentRoutes.get(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(agentIdParamSchema),
  getAgentController,
);
agentRoutes.put(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(agentIdParamSchema),
  validateBody(updateAgentSchema),
  updateAgentController,
);
agentRoutes.patch(
  '/:id/status',
  auth,
  tenant,
  adminOnly,
  validateParams(agentIdParamSchema),
  validateBody(agentStatusSchema),
  setAgentStatusController,
);
agentRoutes.put(
  '/:id/assign-area',
  auth,
  tenant,
  adminOnly,
  validateParams(agentIdParamSchema),
  validateBody(assignAreaSchema),
  assignAgentAreaController,
);
agentRoutes.delete(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(agentIdParamSchema),
  removeAgentController,
);
agentRoutes.get(
  '/:id/performance',
  auth,
  tenant,
  adminOnly,
  validateParams(agentIdParamSchema),
  validateQuery(agentPerformanceQuerySchema),
  getAgentPerformanceController,
);
