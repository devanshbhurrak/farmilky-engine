import { createMiddleware } from 'hono/factory';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { rolePermissions } from '../db/schema/index.js';
import { DEFAULT_ROLE_PERMISSIONS, DELIVERY_ROLES } from '../constants/permissions.js';
import { getCache } from '../cache/index.js';
import type { HonoEnv } from '../types/index.js';

export const requirePermission = (...keys: string[]) =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const { role, tenantId } = c.get('user');
    if (role === 'admin') return await next();
    if (!DELIVERY_ROLES.has(role)) {
      return c.json({ success: false, message: 'Forbidden' }, 403);
    }

    const cacheKey = `perms:${tenantId}:${role}`;
    const cache = getCache();
    let perms = await cache.get<string[]>(cacheKey);
    if (!perms) {
      const rows = await db
        .select({ permissions: rolePermissions.permissions })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, role as 'agent')))
        .limit(1);
      perms = rows[0]?.permissions ?? DEFAULT_ROLE_PERMISSIONS[role] ?? [];
      await cache.set(cacheKey, perms, 60);
    }
    const hasAll = keys.every((k) => perms!.includes(k));
    if (!hasAll) {
      return c.json({ success: false, message: 'Insufficient permissions' }, 403);
    }
    await next();
  });
