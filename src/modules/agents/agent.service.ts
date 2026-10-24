import bcrypt from 'bcryptjs';
import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { env } from '../../shared/config/env.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { addDays, istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import type { CreateAgentInput, UpdateAgentInput } from './agent.schema.js';
import {
  agentPerformanceStats,
  clearAreasByAgent,
  countAgents,
  findAgentById,
  findAgentProfileRow,
  findAreaByIdScoped,
  findUserByEmailScoped,
  findUserByPhoneScoped,
  insertAgentProfileRow,
  insertAgentUser,
  isAgentRole,
  listAgents,
  setAreaAgent,
  updateAgentProfileRow,
  updateAgentUserRow,
  type AgentRole,
} from './agent.repository.js';

function sanitize<T extends Record<string, unknown>>(row: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _omitted, ...rest } = row;
  void _omitted;
  return rest;
}

function shapeAgent(row: {
  user: Record<string, unknown>;
  profile: unknown;
  area: unknown;
}) {
  return { user: sanitize(row.user), agentProfile: row.profile, area: row.area };
}

async function loadAgent(tenantId: string, id: string, dbOrTx: DBOrTx, opts: { includeDeleted?: boolean } = {}) {
  const row = await findAgentById(tenantId, id, dbOrTx, opts);
  if (!row || !isAgentRole(row.user.role)) throw new AppError('Agent not found', 404);
  return row;
}

// Syncs both sides of the agent<->area link inside the caller's transaction.
async function syncAgentAreaTx(
  tenantId: string,
  agentId: string,
  prevAreaId: string | null,
  nextAreaId: string | null,
  t: DBOrTx,
) {
  if (prevAreaId && prevAreaId !== nextAreaId) {
    await setAreaAgent(tenantId, prevAreaId, null, t);
  }
  if (nextAreaId) {
    const area = await findAreaByIdScoped(tenantId, nextAreaId, t);
    if (!area) throw new AppError('Area not found', 404);
    if (area.assignedAgentId && area.assignedAgentId !== agentId) {
      await updateAgentUserRow(tenantId, area.assignedAgentId, { assignedAreaId: null }, t, {
        includeDeleted: true,
      });
    }
    await setAreaAgent(tenantId, nextAreaId, agentId, t);
    await updateAgentUserRow(tenantId, agentId, { assignedAreaId: nextAreaId }, t, {
      includeDeleted: true,
    });
  } else {
    await updateAgentUserRow(tenantId, agentId, { assignedAreaId: null }, t, {
      includeDeleted: true,
    });
  }
}

async function setStatusTx(tenantId: string, id: string, isActive: boolean, t: DBOrTx) {
  const row = await loadAgent(tenantId, id, t, { includeDeleted: true });
  if (!isActive) {
    await updateAgentUserRow(
      tenantId,
      id,
      { isActive: false, deletedAt: new Date(), assignedAreaId: null },
      t,
      { includeDeleted: true },
    );
    // NOTE: the pg enum `agent_availability` only allows
    // available|busy|offline, so deactivation maps to 'offline'.
    const profile = await findAgentProfileRow(tenantId, id, t);
    if (profile) {
      await updateAgentProfileRow(tenantId, id, { availability: 'offline' }, t);
    } else {
      await insertAgentProfileRow(tenantId, id, { availability: 'offline' }, t);
    }
    await clearAreasByAgent(tenantId, id, t);
  } else {
    await updateAgentUserRow(
      tenantId,
      id,
      { isActive: true, deletedAt: null },
      t,
      { includeDeleted: true },
    );
    const profile = await findAgentProfileRow(tenantId, id, t);
    if (profile) {
      await updateAgentProfileRow(tenantId, id, { availability: 'available' }, t);
    } else {
      await insertAgentProfileRow(tenantId, id, { availability: 'available' }, t);
    }
  }
  void row;
  return { id, isActive };
}

// ---------- queries ----------

export async function listAgentsService(
  tenantId: string,
  filters: { search?: string },
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const [items, total] = await Promise.all([
    listAgents(tenantId, filters, pagination, dbOrTx),
    countAgents(tenantId, filters, dbOrTx),
  ]);
  return { items: items.map(shapeAgent), total };
}

export async function getAgentService(tenantId: string, id: string, dbOrTx: DBOrTx = db) {
  const row = await loadAgent(tenantId, id, dbOrTx);
  return shapeAgent(row);
}

// ---------- mutations ----------

export async function createAgentService(
  tenantId: string,
  input: CreateAgentInput,
  adminId?: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const existingPhone = await findUserByPhoneScoped(tenantId, input.phone, t);
    if (existingPhone) throw new AppError('Phone already registered', 409);
    if (input.email) {
      const existingEmail = await findUserByEmailScoped(tenantId, input.email, t);
      if (existingEmail) throw new AppError('Email already registered', 409);
    }
    if (input.assignedAreaId) {
      const area = await findAreaByIdScoped(tenantId, input.assignedAreaId, t);
      if (!area) throw new AppError('Area not found', 404);
    }

    const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);
    const user = await insertAgentUser(
      tenantId,
      {
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
        role: (input.role ?? 'delivery') as AgentRole,
        assignedAreaId: input.assignedAreaId ?? null,
        deliverySequence: input.deliverySequence ?? null,
        createdById: adminId ?? null,
      },
      t,
    );
    const profile = await insertAgentProfileRow(
      tenantId,
      user.id,
      {
        availability: 'available',
        joiningDate: input.joiningDate ?? null,
        vehicleType: input.vehicleType ?? null,
        maxCapacity: input.maxCapacity ?? null,
      },
      t,
    );
    let area: unknown = null;
    if (input.assignedAreaId) {
      const target = await findAreaByIdScoped(tenantId, input.assignedAreaId, t);
      if (target?.assignedAgentId && target.assignedAgentId !== user.id) {
        await updateAgentUserRow(
          tenantId,
          target.assignedAgentId,
          { assignedAreaId: null },
          t,
          { includeDeleted: true },
        );
      }
      await setAreaAgent(tenantId, input.assignedAreaId, user.id, t);
      area = await findAreaByIdScoped(tenantId, input.assignedAreaId, t);
    }
    return { user: sanitize(user), agentProfile: profile, area };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function updateAgentService(
  tenantId: string,
  id: string,
  input: UpdateAgentInput & { role?: unknown },
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const row = await loadAgent(tenantId, id, t);
    // Role can never change here — drop it even if a client sends it.
    const { role: _ignored, ...patch } = input;
    void _ignored;

    if (patch.phone && patch.phone !== row.user.phone) {
      const dup = await findUserByPhoneScoped(tenantId, patch.phone, t);
      if (dup && dup.id !== id) throw new AppError('Phone already registered', 409);
    }
    if (patch.email && patch.email !== row.user.email) {
      const dup = await findUserByEmailScoped(tenantId, patch.email, t);
      if (dup && dup.id !== id) throw new AppError('Email already registered', 409);
    }

    const userPatch: Parameters<typeof updateAgentUserRow>[2] = {};
    if (patch.name !== undefined) userPatch.name = patch.name;
    if (patch.phone !== undefined) userPatch.phone = patch.phone;
    if (patch.email !== undefined) userPatch.email = patch.email;
    if (patch.password !== undefined) {
      userPatch.passwordHash = await bcrypt.hash(patch.password, env.bcryptRounds);
    }
    if (patch.deliverySequence !== undefined) userPatch.deliverySequence = patch.deliverySequence;
    if (Object.keys(userPatch).length > 0) {
      await updateAgentUserRow(tenantId, id, userPatch, t);
    }

    if (patch.assignedAreaId !== undefined) {
      await syncAgentAreaTx(
        tenantId,
        id,
        row.user.assignedAreaId as string | null,
        patch.assignedAreaId,
        t,
      );
    }

    if (
      patch.joiningDate !== undefined ||
      patch.vehicleType !== undefined ||
      patch.maxCapacity !== undefined
    ) {
      const existing = await findAgentProfileRow(tenantId, id, t);
      const profilePatch: Parameters<typeof updateAgentProfileRow>[2] = {};
      if (patch.joiningDate !== undefined) profilePatch.joiningDate = patch.joiningDate;
      if (patch.vehicleType !== undefined) profilePatch.vehicleType = patch.vehicleType;
      if (patch.maxCapacity !== undefined) profilePatch.maxCapacity = patch.maxCapacity;
      if (existing) {
        await updateAgentProfileRow(tenantId, id, profilePatch, t);
      } else {
        await insertAgentProfileRow(tenantId, id, { availability: 'available', ...profilePatch }, t);
      }
    }

    const updated = await loadAgent(tenantId, id, t);
    return shapeAgent(updated);
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function setAgentStatusService(
  tenantId: string,
  id: string,
  isActive: boolean,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => setStatusTx(tenantId, id, isActive, t);
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function assignAgentAreaService(
  tenantId: string,
  id: string,
  areaId: string | null,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const row = await loadAgent(tenantId, id, t);
    if (areaId) {
      const area = await findAreaByIdScoped(tenantId, areaId, t);
      if (!area) throw new AppError('Area not found', 404);
    }
    await syncAgentAreaTx(tenantId, id, row.user.assignedAreaId as string | null, areaId, t);
    const updated = await loadAgent(tenantId, id, t);
    return shapeAgent(updated);
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function removeAgentService(tenantId: string, id: string, tx?: DrizzleTx) {
  const run = async (t: DBOrTx) => {
    await setStatusTx(tenantId, id, false, t);
    return { deleted: true, id };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function getAgentPerformanceService(
  tenantId: string,
  id: string,
  opts: { startDate?: string },
  dbOrTx: DBOrTx = db,
) {
  const row = await loadAgent(tenantId, id, dbOrTx);
  const startDate = opts.startDate ?? toDateOnlyString(addDays(istToday(), -30));
  const stats = await agentPerformanceStats(tenantId, id, startDate, dbOrTx);
  void row;
  return {
    agentId: id,
    startDate,
    total: Number(stats.total ?? 0),
    delivered: Number(stats.delivered ?? 0),
    failed: Number(stats.failed ?? 0),
    successRate: stats.successRate == null ? null : Number(stats.successRate),
  };
}
