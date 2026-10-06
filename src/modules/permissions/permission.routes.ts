import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  getMyPermissionsController,
  getRegistryController,
  listRolesController,
  resetRoleController,
  updateRoleController,
} from './permission.controller.js';
import { roleParamSchema, updateRoleSchema } from './permission.schema.js';

export const permissionRoutes = new Hono<HonoEnv>();

permissionRoutes.get('/my', auth, tenant, getMyPermissionsController);
permissionRoutes.get('/registry', auth, tenant, adminOnly, getRegistryController);
permissionRoutes.get('/roles', auth, tenant, adminOnly, listRolesController);
permissionRoutes.put(
  '/roles/:role',
  auth,
  tenant,
  adminOnly,
  validateParams(roleParamSchema),
  validateBody(updateRoleSchema),
  updateRoleController,
);
permissionRoutes.post(
  '/roles/:role/reset',
  auth,
  tenant,
  adminOnly,
  validateParams(roleParamSchema),
  resetRoleController,
);
