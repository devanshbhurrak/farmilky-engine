import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import type { AssignCustomersInput, CreateAreaInput, UpdateAreaInput } from './area.schema.js';
import {
  assignCustomerToArea,
  clearAgentFromArea,
  countAgents,
  countAreas,
  countCustomersInArea,
  countUsersInArea,
  createAreaRow,
  findAreaById,
  listAgents,
  listAreas,
  listCustomersInArea,
  removeCustomerFromArea,
  setUserAssignedArea,
  softDeleteAreaRow,
  updateAreaRow,
} from './area.repository.js';

export async function listAreasService(
  tenantId: string,
  opts: { page: number; limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const [items, total] = await Promise.all([
    listAreas(tenantId, { limit: opts.limit, offset: opts.offset }, dbOrTx),
    countAreas(tenantId, dbOrTx),
  ]);
  return { items, total };
}

export async function getAreaService(tenantId: string, areaId: string, dbOrTx: DBOrTx = db) {
  const area = await findAreaById(tenantId, areaId, dbOrTx);
  if (!area) throw new AppError('Area not found', 404);
  return area;
}

export async function createAreaService(tenantId: string, input: CreateAreaInput, tx?: DrizzleTx) {
  const run = async (t: DBOrTx) => {
    const area = await createAreaRow(tenantId, input, t);
    if (input.assignedAgentId) {
      await setUserAssignedArea(tenantId, input.assignedAgentId, area.id, t);
    }
    return area;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function updateAreaService(
  tenantId: string,
  areaId: string,
  input: UpdateAreaInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const existing = await findAreaById(tenantId, areaId, t);
    if (!existing) throw new AppError('Area not found', 404);

    if (input.assignedAgentId !== undefined && input.assignedAgentId !== existing.assignedAgentId) {
      if (input.assignedAgentId) {
        await setUserAssignedArea(tenantId, input.assignedAgentId, areaId, t);
      }
      if (existing.assignedAgentId) {
        await clearAgentFromArea(tenantId, areaId, existing.assignedAgentId, t);
      }
    }

    const updated = await updateAreaRow(tenantId, areaId, input, t);
    if (!updated) throw new AppError('Area not found', 404);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function deleteAreaService(tenantId: string, areaId: string, tx?: DrizzleTx) {
  const run = async (t: DBOrTx) => {
    const existing = await findAreaById(tenantId, areaId, t);
    if (!existing) throw new AppError('Area not found', 404);
    const assigned = await countUsersInArea(tenantId, areaId, t);
    if (assigned > 0) throw new AppError('Cannot delete area with assigned users', 400);
    await softDeleteAreaRow(tenantId, areaId, t);
    return { deleted: true };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function listAgentsService(
  tenantId: string,
  opts: { page: number; limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const [items, total] = await Promise.all([
    listAgents(tenantId, { limit: opts.limit, offset: opts.offset }, dbOrTx),
    countAgents(tenantId, dbOrTx),
  ]);
  return { items, total };
}

export async function listAreaCustomersService(
  tenantId: string,
  areaId: string,
  opts: { page: number; limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const area = await findAreaById(tenantId, areaId, dbOrTx);
  if (!area) throw new AppError('Area not found', 404);
  const [items, total] = await Promise.all([
    listCustomersInArea(tenantId, areaId, { limit: opts.limit, offset: opts.offset }, dbOrTx),
    countCustomersInArea(tenantId, areaId, dbOrTx),
  ]);
  return { items, total };
}

export async function updateAreaCustomersService(
  tenantId: string,
  areaId: string,
  input: AssignCustomersInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const area = await findAreaById(tenantId, areaId, t);
    if (!area) throw new AppError('Area not found', 404);
    for (const a of input.assign) {
      await assignCustomerToArea(tenantId, a.userId, areaId, a.deliverySequence, t);
    }
    for (const userId of input.remove) {
      await removeCustomerFromArea(tenantId, userId, t);
    }
    return { assigned: input.assign.length, removed: input.remove.length };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}
