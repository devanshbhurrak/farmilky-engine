import { and, eq } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { rolePermissions } from '../../shared/db/schema/index.js';

export async function findByRole(tenantId: string, role: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(rolePermissions)
    .where(
      and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, role as 'agent')),
    )
    .limit(1);
  return rows[0];
}

export async function listRoles(tenantId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.tenantId, tenantId));
}

export async function upsertRole(
  tenantId: string,
  role: string,
  permissions: string[],
  updatedById?: string | null,
  dbOrTx: DBOrTx = db,
) {
  const existing = await findByRole(tenantId, role, dbOrTx);
  if (existing) {
    const rows = await (dbOrTx as typeof db)
      .update(rolePermissions)
      .set({ permissions, updatedById: updatedById ?? null, updatedAt: new Date() })
      .where(eq(rolePermissions.id, existing.id))
      .returning();
    return rows[0]!;
  }
  const rows = await (dbOrTx as typeof db)
    .insert(rolePermissions)
    .values({ tenantId, role: role as 'agent', permissions, updatedById: updatedById ?? null })
    .returning();
  return rows[0]!;
}

export async function deleteRole(tenantId: string, role: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .delete(rolePermissions)
    .where(
      and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, role as 'agent')),
    )
    .returning({ id: rolePermissions.id });
  return rows[0];
}
