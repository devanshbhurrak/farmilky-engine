import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  DELIVERY_ROLES,
  PERMISSION_META,
} from '../../shared/constants/permissions.js';
import { getCache } from '../../shared/cache/index.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { deleteRole, findByRole, listRoles, upsertRole } from './permission.repository.js';
import type { DeliveryRole } from '../../shared/db/schema/enums.js';

const MANAGED_ROLES = ['agent', 'delivery', 'delivery_partner'] as const;

function permsCacheKey(tenantId: string, role: string): string {
  return `perms:${tenantId}:${role}`;
}

export async function getMyPermissions(role: string, tenantId: string): Promise<string[]> {
  if (role === 'admin') return ['*'];
  if (!DELIVERY_ROLES.has(role as DeliveryRole)) return [];
  const row = await findByRole(tenantId, role as DeliveryRole);
  return row?.permissions ?? DEFAULT_ROLE_PERMISSIONS[role as DeliveryRole] ?? [];
}

export function getRegistry() {
  return {
    permissions: ALL_PERMISSIONS,
    meta: PERMISSION_META,
    registry: ALL_PERMISSIONS.map((key) => ({
      key,
      label: PERMISSION_META[key]?.label ?? key,
      group: PERMISSION_META[key]?.group ?? 'Other',
    })),
  };
}

export async function getRolePermissions(tenantId: string, role: DeliveryRole): Promise<string[]> {
  const row = await findByRole(tenantId, role);
  return row?.permissions ?? DEFAULT_ROLE_PERMISSIONS[role] ?? [];
}

export async function getRoles(tenantId: string) {
  const rows = await listRoles(tenantId);
  const byRole = new Map(rows.map((r) => [r.role, r]));
  const result: Array<{ role: string; permissions: string[] }> = [];
  for (const role of MANAGED_ROLES) {
    const existing = byRole.get(role);
    if (existing) {
      result.push({ role, permissions: existing.permissions });
      continue;
    }
    // Lazy-seed defaults on first admin view.
    const defaults = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
    await upsertRole(tenantId, role, [...defaults]);
    result.push({ role, permissions: defaults });
  }
  return result;
}

export async function updateRole(
  tenantId: string,
  role: DeliveryRole,
  permissions: string[],
  updatedById?: string | null,
) {
  const unknown = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknown.length > 0) {
    throw new AppError(`Unknown permissions: ${unknown.join(', ')}`, 400);
  }
  const row = await upsertRole(tenantId, role, [...new Set(permissions)], updatedById ?? null);
  await getCache().del(permsCacheKey(tenantId, role));
  return { role: row.role, permissions: row.permissions };
}

export async function resetRole(tenantId: string, role: DeliveryRole) {
  await deleteRole(tenantId, role);
  await getCache().del(permsCacheKey(tenantId, role));
  return { role, permissions: DEFAULT_ROLE_PERMISSIONS[role] ?? [] };
}
