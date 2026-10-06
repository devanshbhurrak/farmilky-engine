import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { ok } from '../../shared/utils/response.js';
import type { RoleParam, UpdateRoleInput } from './permission.schema.js';
import {
  getMyPermissions,
  getRegistry,
  getRoles,
  resetRole,
  updateRole,
} from './permission.service.js';

export const getMyPermissionsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const permissions = await getMyPermissions(user.role, user.tenantId);
  return ok(c, { permissions });
};

export const getRegistryController = async (c: Context) => {
  void c;
  return ok(c, getRegistry());
};

export const listRolesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const roles = await getRoles(user.tenantId);
  return ok(c, { roles });
};

export const updateRoleController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as RoleParam;
  const body = c.get('body') as UpdateRoleInput;
  const role = await updateRole(user.tenantId, params.role, body.permissions, user.id);
  return ok(c, { role });
};

export const resetRoleController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as RoleParam;
  const role = await resetRole(user.tenantId, params.role);
  return ok(c, { role });
};
