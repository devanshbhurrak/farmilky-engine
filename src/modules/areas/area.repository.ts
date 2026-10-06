import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { areas, users } from '../../shared/db/schema/index.js';

export async function listAreas(
  tenantId: string,
  opts: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(areas)
    .where(and(eq(areas.tenantId, tenantId), isNull(areas.deletedAt)))
    .orderBy(areas.sortOrder, areas.name)
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function countAreas(tenantId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(areas)
    .where(and(eq(areas.tenantId, tenantId), isNull(areas.deletedAt)));
  return rows[0]?.value ?? 0;
}

export async function findAreaById(tenantId: string, areaId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(areas)
    .where(and(eq(areas.tenantId, tenantId), eq(areas.id, areaId), isNull(areas.deletedAt)))
    .limit(1);
  return rows[0];
}

export interface NewAreaRow {
  name: string;
  pincodes?: string[];
  localities?: string[];
  assignedAgentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export async function createAreaRow(tenantId: string, data: NewAreaRow, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .insert(areas)
    .values({
      tenantId,
      name: data.name,
      pincodes: data.pincodes ?? [],
      localities: data.localities ?? [],
      assignedAgentId: data.assignedAgentId ?? null,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
    })
    .returning();
  return rows[0]!;
}

export async function updateAreaRow(
  tenantId: string,
  areaId: string,
  data: Partial<NewAreaRow>,
  dbOrTx: DBOrTx = db,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.pincodes !== undefined) patch.pincodes = data.pincodes;
  if (data.localities !== undefined) patch.localities = data.localities;
  if (data.assignedAgentId !== undefined) patch.assignedAgentId = data.assignedAgentId;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  const rows = await (dbOrTx as typeof db)
    .update(areas)
    .set(patch)
    .where(and(eq(areas.tenantId, tenantId), eq(areas.id, areaId), isNull(areas.deletedAt)))
    .returning();
  return rows[0];
}

export async function softDeleteAreaRow(tenantId: string, areaId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .update(areas)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(areas.tenantId, tenantId), eq(areas.id, areaId), isNull(areas.deletedAt)))
    .returning({ id: areas.id });
  return rows[0];
}

export async function countUsersInArea(tenantId: string, areaId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(users)
    .where(
      and(eq(users.tenantId, tenantId), eq(users.assignedAreaId, areaId), isNull(users.deletedAt)),
    );
  return rows[0]?.value ?? 0;
}

export async function setUserAssignedArea(
  tenantId: string,
  userId: string,
  areaId: string | null,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(users)
    .set({ assignedAreaId: areaId, updatedAt: new Date() })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
    .returning({ id: users.id });
  return rows[0];
}

export async function clearAgentFromArea(
  tenantId: string,
  areaId: string,
  agentId: string,
  dbOrTx: DBOrTx = db,
) {
  await (dbOrTx as typeof db)
    .update(users)
    .set({ assignedAreaId: null, updatedAt: new Date() })
    .where(
      and(eq(users.tenantId, tenantId), eq(users.id, agentId), eq(users.assignedAreaId, areaId)),
    );
}

const AGENT_ROLES = ['agent', 'delivery', 'delivery_partner'] as const;

export async function listAgents(
  tenantId: string,
  opts: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        inArray(users.role, [...AGENT_ROLES]),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(users.name)
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function countAgents(tenantId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        inArray(users.role, [...AGENT_ROLES]),
        isNull(users.deletedAt),
      ),
    );
  return rows[0]?.value ?? 0;
}

export async function listCustomersInArea(
  tenantId: string,
  areaId: string,
  opts: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.assignedAreaId, areaId),
        eq(users.role, 'customer'),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(sql`${users.deliverySequence} ASC NULLS LAST`, users.name)
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function countCustomersInArea(tenantId: string, areaId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.assignedAreaId, areaId),
        eq(users.role, 'customer'),
        isNull(users.deletedAt),
      ),
    );
  return rows[0]?.value ?? 0;
}

export async function assignCustomerToArea(
  tenantId: string,
  userId: string,
  areaId: string,
  deliverySequence: number | undefined,
  dbOrTx: DBOrTx = db,
) {
  const patch: Record<string, unknown> = { assignedAreaId: areaId, updatedAt: new Date() };
  if (deliverySequence !== undefined) patch.deliverySequence = deliverySequence;
  const rows = await (dbOrTx as typeof db)
    .update(users)
    .set(patch)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
    .returning({ id: users.id });
  return rows[0];
}

export async function removeCustomerFromArea(tenantId: string, userId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .update(users)
    .set({ assignedAreaId: null, deliverySequence: null, updatedAt: new Date() })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
    .returning({ id: users.id });
  return rows[0];
}
