import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  getMyPermissionsController,
  getRegistryController,
  getRolePermissionsController,
  listPermissionAssignmentsController,
  listRolesController,
  resetRoleController,
  setUserPermissionsController,
  updateRoleController,
} from './permission.controller.js';
import { roleParamSchema, updateRoleSchema, userIdParamSchema } from './permission.schema.js';

export const permissionRoutes = new Hono<HonoEnv>();

// List all user-level permission assignments (returns empty until per-user
// overrides are implemented in the data layer).
permissionRoutes.get('/', auth, tenant, adminOnly, listPermissionAssignmentsController);
permissionRoutes.get('/my', auth, tenant, getMyPermissionsController);
permissionRoutes.get('/registry', auth, tenant, adminOnly, getRegistryController);
permissionRoutes.get('/roles', auth, tenant, adminOnly, listRolesController);
// Get permissions for a specific role — must be registered before the PUT /:role to avoid shadowing
permissionRoutes.get(
  '/roles/:role',
  auth,
  tenant,
  adminOnly,
  validateParams(roleParamSchema),
  getRolePermissionsController,
);
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
// Per-user permission override — stub until the data layer supports it.
permissionRoutes.put(
  '/:userId',
  auth,
  tenant,
  adminOnly,
  validateParams(userIdParamSchema),
  validateBody(updateRoleSchema),
  setUserPermissionsController,
);
