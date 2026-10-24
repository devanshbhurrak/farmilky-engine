import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import {
  agentProfiles,
  areas,
  deliveryManifests,
  manifestEntries,
  users,
} from '../../shared/db/schema/index.js';

export const AGENT_ROLES = ['agent', 'delivery', 'delivery_partner'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export function isAgentRole(role: unknown): role is AgentRole {
  return role === 'agent' || role === 'delivery' || role === 'delivery_partner';
}

function searchCondition(search: string | undefined) {
  if (!search?.trim()) return undefined;
  const q = `%${search.trim()}%`;
  return or(ilike(users.name, q), ilike(users.phone, q), ilike(users.email, q));
}

// ---------- list / count ----------

export async function listAgents(
  tenantId: string,
  filters: { search?: string },
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(users.tenantId, tenantId),
    inArray(users.role, [...AGENT_ROLES]),
    isNull(users.deletedAt),
  ];
  const search = searchCondition(filters.search);
  if (search) conditions.push(search);
  return (dbOrTx as typeof db)
    .select({ user: users, profile: agentProfiles, area: areas })
    .from(users)
    .leftJoin(
      agentProfiles,
      and(eq(agentProfiles.userId, users.id), eq(agentProfiles.tenantId, users.tenantId)),
    )
    .leftJoin(areas, eq(areas.id, users.assignedAreaId))
    .where(and(...conditions))
    .orderBy(desc(users.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
}

export async function countAgents(
  tenantId: string,
  filters: { search?: string },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(users.tenantId, tenantId),
    inArray(users.role, [...AGENT_ROLES]),
    isNull(users.deletedAt),
  ];
  const search = searchCondition(filters.search);
  if (search) conditions.push(search);
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(users)
    .where(and(...conditions));
  return rows[0]?.value ?? 0;
}

// ---------- single-agent reads ----------

export async function findAgentById(
  tenantId: string,
  id: string,
  dbOrTx: DBOrTx = db,
  opts: { includeDeleted?: boolean } = {},
) {
  const conditions = [eq(users.tenantId, tenantId), eq(users.id, id)];
  if (!opts.includeDeleted) conditions.push(isNull(users.deletedAt));
  const rows = await (dbOrTx as typeof db)
    .select({ user: users, profile: agentProfiles, area: areas })
    .from(users)
    .leftJoin(
      agentProfiles,
      and(eq(agentProfiles.userId, users.id), eq(agentProfiles.tenantId, users.tenantId)),
    )
    .leftJoin(areas, eq(areas.id, users.assignedAreaId))
    .where(and(...conditions))
    .limit(1);
  return rows[0];
}

export async function findUserByPhoneScoped(tenantId: string, phone: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function findUserByEmailScoped(tenantId: string, email: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

// ---------- writes: users ----------

export interface NewAgentUser {
  name: string;
  phone: string;
  email: string | null;
  passwordHash: string;
  role: AgentRole;
  assignedAreaId?: string | null;
  deliverySequence?: number | null;
  createdById?: string | null;
}

export async function insertAgentUser(tenantId: string, data: NewAgentUser, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .insert(users)
    .values({
      tenantId,
      name: data.name,
      phone: data.phone,
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      assignedAreaId: data.assignedAreaId ?? null,
      deliverySequence: data.deliverySequence ?? null,
      createdById: data.createdById ?? null,
    })
    .returning();
  return rows[0]!;
}

export async function updateAgentUserRow(
  tenantId: string,
  id: string,
  patch: Partial<{
    name: string;
    phone: string;
    email: string | null;
    passwordHash: string;
    isActive: boolean;
    deletedAt: Date | null;
    assignedAreaId: string | null;
    deliverySequence: number | null;
    updatedById: string | null;
  }>,
  dbOrTx: DBOrTx = db,
  opts: { includeDeleted?: boolean } = {},
) {
  const conditions = [eq(users.tenantId, tenantId), eq(users.id, id)];
  if (!opts.includeDeleted) conditions.push(isNull(users.deletedAt));
  const rows = await (dbOrTx as typeof db)
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  return rows[0];
}

// ---------- writes: agent profiles ----------

export async function findAgentProfileRow(
  tenantId: string,
  userId: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.tenantId, tenantId), eq(agentProfiles.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function insertAgentProfileRow(
  tenantId: string,
  userId: string,
  data: {
    availability?: 'available' | 'busy' | 'offline';
    joiningDate?: string | null;
    vehicleType?: string | null;
    maxCapacity?: number | null;
  },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(agentProfiles)
    .values({
      tenantId,
      userId,
      availability: data.availability ?? 'available',
      joiningDate: data.joiningDate ?? null,
      vehicleType: data.vehicleType ?? null,
      maxCapacity: data.maxCapacity ?? null,
    })
    .returning();
  return rows[0]!;
}

export async function updateAgentProfileRow(
  tenantId: string,
  userId: string,
  patch: Partial<{
    availability: 'available' | 'busy' | 'offline';
    joiningDate: string | null;
    vehicleType: string | null;
    maxCapacity: number | null;
  }>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(agentProfiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(agentProfiles.tenantId, tenantId), eq(agentProfiles.userId, userId)))
    .returning();
  return rows[0];
}

// ---------- areas (read directly in this repo file) ----------

export async function findAreaByIdScoped(tenantId: string, areaId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(areas)
    .where(and(eq(areas.tenantId, tenantId), eq(areas.id, areaId), isNull(areas.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function setAreaAgent(
  tenantId: string,
  areaId: string,
  agentId: string | null,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(areas)
    .set({ assignedAgentId: agentId, updatedAt: new Date() })
    .where(and(eq(areas.tenantId, tenantId), eq(areas.id, areaId), isNull(areas.deletedAt)))
    .returning({ id: areas.id });
  return rows[0];
}

export async function clearAreasByAgent(tenantId: string, agentId: string, dbOrTx: DBOrTx = db) {
  await (dbOrTx as typeof db)
    .update(areas)
    .set({ assignedAgentId: null, updatedAt: new Date() })
    .where(
      and(
        eq(areas.tenantId, tenantId),
        eq(areas.assignedAgentId, agentId),
        isNull(areas.deletedAt),
      ),
    );
}

// ---------- performance aggregate ----------

export async function agentPerformanceStats(
  tenantId: string,
  agentId: string,
  startDate: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select({
      total: count(),
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${manifestEntries.status} = 'delivered')`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${manifestEntries.status} = 'failed')`,
      successRate: sql<number | null>`ROUND(COUNT(*) FILTER (WHERE ${manifestEntries.status} = 'delivered') * 100.0 / NULLIF(COUNT(*), 0), 1)`,
    })
    .from(manifestEntries)
    .innerJoin(deliveryManifests, eq(deliveryManifests.id, manifestEntries.manifestId))
    .where(
      and(
        eq(deliveryManifests.tenantId, tenantId),
        eq(deliveryManifests.agentId, agentId),
        gte(deliveryManifests.manifestDate, startDate),
      ),
    );
  return rows[0]!;
}
