import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { findActiveByParty } from '../transactions/transaction.repository.js';
import { transactionService } from '../transactions/transaction.service.js';
import {
  countConfirmedUnsettled,
  findSupplierById,
  findSupplierByPhone,
  hasSettlementForTxn,
  insertSupplier,
  listSuppliers,
  softDeleteSupplierRow,
  updateSupplierRow,
} from './supplier.repository.js';
import type {
  AdjustmentInput,
  CreateSupplierInput,
  SupplierListQuery,
  SupplierPassbookQuery,
  UpdateSupplierInput,
} from './supplier.schema.js';

export async function createSupplier(
  tenantId: string,
  input: CreateSupplierInput,
  _adminId?: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findSupplierByPhone(tenantId, input.phone, t);
    if (existing) throw new AppError('Supplier phone already exists', 409);
    return insertSupplier(tenantId, input, t);
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function getSupplier(tenantId: string, supplierId: string, dbOrTx: DBOrTx = db) {
  const supplier = await findSupplierById(tenantId, supplierId, dbOrTx);
  if (!supplier) throw new AppError('Supplier not found', 404);
  return supplier;
}

export async function listSuppliersService(tenantId: string, query: SupplierListQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listSuppliers(tenantId, { limit, offset }, dbOrTx);
  return { rows, meta: buildMeta(total, page, limit) };
}

export async function updateSupplier(
  tenantId: string,
  supplierId: string,
  input: UpdateSupplierInput,
  _adminId?: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findSupplierById(tenantId, supplierId, t);
    if (!existing) throw new AppError('Supplier not found', 404);
    if (input.phone && input.phone !== existing.phone) {
      const clash = await findSupplierByPhone(tenantId, input.phone, t);
      if (clash) throw new AppError('Supplier phone already exists', 409);
    }
    const updated = await updateSupplierRow(tenantId, supplierId, input, t);
    if (!updated) throw new AppError('Supplier not found', 404);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function deleteSupplier(tenantId: string, supplierId: string, _adminId?: string, tx?: DrizzleTx) {
  const run = async (t: DrizzleTx) => {
    const existing = await findSupplierById(tenantId, supplierId, t);
    if (!existing) throw new AppError('Supplier not found', 404);
    const deleted = await softDeleteSupplierRow(tenantId, supplierId, t);
    if (!deleted) throw new AppError('Supplier not found', 404);
    return deleted;
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function setSupplierStatus(
  tenantId: string,
  supplierId: string,
  isActive: boolean,
  _adminId?: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findSupplierById(tenantId, supplierId, t);
    if (!existing) throw new AppError('Supplier not found', 404);
    const updated = await updateSupplierRow(tenantId, supplierId, { isActive }, t);
    if (!updated) throw new AppError('Supplier not found', 404);
    if (!isActive) {
      const unsettled = await countConfirmedUnsettled(tenantId, supplierId, t);
      if (unsettled > 0) {
        return {
          supplier: updated,
          warning: `Supplier has ${unsettled} confirmed-but-unsettled collection(s). Settle dues before deactivating.`,
        };
      }
    }
    return { supplier: updated };
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function getSupplierPassbook(
  tenantId: string,
  supplierId: string,
  query: SupplierPassbookQuery,
  dbOrTx: DBOrTx = db,
) {
  const supplier = await findSupplierById(tenantId, supplierId, dbOrTx);
  if (!supplier) throw new AppError('Supplier not found', 404);
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await findActiveByParty(tenantId, 'supplier', supplierId, {}, { limit, offset }, dbOrTx);
  return { rows, meta: buildMeta(total, page, limit) };
}

export async function createSupplierAdjustment(
  tenantId: string,
  supplierId: string,
  input: AdjustmentInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const supplier = await findSupplierById(tenantId, supplierId, t);
    if (!supplier) throw new AppError('Supplier not found', 404);
    const effectiveDate = input.effectiveDate ?? toDateOnlyString(istToday());
    return transactionService.createTransaction(
      {
        tenantId,
        partyType: 'supplier',
        partyId: supplierId,
        txnType: 'supplier_adjustment',
        txnCategory: input.category ?? 'other',
        entryType: input.entryType,
        amount: input.amount,
        effectiveDate,
        description: input.description,
        notes: input.notes ?? null,
        createdById: adminId,
      },
      t,
    );
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function deleteSupplierAdjustment(
  tenantId: string,
  _supplierId: string,
  adjId: string,
  reason: string,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const settled = await hasSettlementForTxn(adjId, t);
    if (settled) throw new AppError('Adjustment is settled, cannot delete', 400);
    return transactionService.deleteTransaction(adjId, tenantId, reason, adminId, t);
  };
  if (tx) return run(tx);
  return withTransaction(run);
}
