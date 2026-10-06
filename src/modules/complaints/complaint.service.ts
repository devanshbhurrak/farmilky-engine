import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import type {
  ComplaintListQuery,
  CreateComplaintInput,
  UpdateComplaintStatusInput,
} from './complaint.schema.js';
import {
  findComplaintById,
  insertComplaint,
  listAllComplaints,
  listComplaintsByUser,
  updateComplaintRow,
} from './complaint.repository.js';

export async function create(tenantId: string, userId: string, input: CreateComplaintInput, tx?: DrizzleTx) {
  const run = async (t: DrizzleTx) =>
    insertComplaint(
      tenantId,
      {
        userId,
        relatedTo: input.relatedTo,
        referenceId: input.referenceId ?? null,
        referenceType: input.referenceType ?? null,
        subject: input.subject,
        description: input.description,
      },
      t,
    );
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function listMine(tenantId: string, userId: string, query: ComplaintListQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listComplaintsByUser(
    tenantId,
    userId,
    { limit, offset, status: query.status },
    dbOrTx,
  );
  return { rows, meta: buildMeta(total, page, limit) };
}

export async function getById(
  tenantId: string,
  complaintId: string,
  userId: string,
  isAdmin: boolean,
  dbOrTx: DBOrTx = db,
) {
  const complaint = await findComplaintById(tenantId, complaintId, dbOrTx);
  if (!complaint) throw new AppError('Complaint not found', 404);
  if (!isAdmin && complaint.userId !== userId) throw new AppError('Forbidden', 403);
  return complaint;
}

export async function listAdmin(tenantId: string, query: ComplaintListQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listAllComplaints(tenantId, { limit, offset, status: query.status }, dbOrTx);
  return { rows, meta: buildMeta(total, page, limit) };
}

export async function updateStatus(
  tenantId: string,
  complaintId: string,
  adminId: string,
  input: UpdateComplaintStatusInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findComplaintById(tenantId, complaintId, t);
    if (!existing) throw new AppError('Complaint not found', 404);
    const isResolved = input.status === 'resolved' || input.status === 'closed';
    const updated = await updateComplaintRow(
      tenantId,
      complaintId,
      {
        status: input.status,
        resolution: input.resolution !== undefined ? input.resolution : existing.resolution,
        resolvedAt: isResolved ? new Date() : null,
        resolvedById: isResolved ? adminId : null,
      },
      t,
    );
    if (!updated) throw new AppError('Complaint not found', 404);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction(run);
}
