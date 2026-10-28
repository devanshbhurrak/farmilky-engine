import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { findActiveByParty } from '../transactions/transaction.repository.js';
import { transactionService } from '../transactions/transaction.service.js';
import { listConfirmedUnsettled as listUnsettledCollections } from '../milk-collections/milkCollection.repository.js';
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

async function computeSupplierOutstanding(tenantId: string, supplierId: string, dbOrTx: DBOrTx = db) {
  const unsettled = await listUnsettledCollections(tenantId, supplierId, dbOrTx);
  const outstandingAmount = unsettled.reduce((sum, item) => sum + Number(item.txnAmount), 0);
  return { outstandingAmount, collectionCount: unsettled.length };
}

function toCollectionSessions(supplier: { morningSession: boolean; eveningSession: boolean }): string[] {
  const sessions: string[] = [];
  if (supplier.morningSession) sessions.push('morning');
  if (supplier.eveningSession) sessions.push('evening');
  return sessions;
}

export async function createSupplier(
  tenantId: string,
  input: CreateSupplierInput,
  _adminId?: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findSupplierByPhone(tenantId, input.phone, t);
    if (existing) throw new AppError('Supplier phone already exists', 409);
    const created = await insertSupplier(tenantId, input, t);
    
    // Return enriched supplier with computed fields (will be 0 for new supplier)
    const balance = Number(created.balance ?? 0);
    return {
      ...created,
      balance,
      outstandingAmount: 0,
      totalPaid: 0,
      collectionSessions: toCollectionSessions(created),
    };
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function getSupplier(tenantId: string, supplierId: string, dbOrTx: DBOrTx = db) {
  const supplier = await findSupplierById(tenantId, supplierId, dbOrTx);
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  // Compute outstanding amount from unsettled collections
  const { outstandingAmount } = await computeSupplierOutstanding(tenantId, supplierId, dbOrTx);
  const balance = Number(supplier.balance ?? 0);
  const totalPaid = Math.max(0, -balance + outstandingAmount);
  
  return {
    ...supplier,
    balance: balance,
    outstandingAmount,
    totalPaid,
    collectionSessions: toCollectionSessions(supplier),
  };
}

export async function listSuppliersService(tenantId: string, query: SupplierListQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listSuppliers(tenantId, { limit, offset }, dbOrTx);
  
  // Enrich each supplier with computed fields
  const enrichedRows = await Promise.all(
    rows.map(async (supplier) => {
      const { outstandingAmount } = await computeSupplierOutstanding(tenantId, supplier.id, dbOrTx);
      const balance = Number(supplier.balance ?? 0);
      const totalPaid = Math.max(0, -balance + outstandingAmount);
      return {
        ...supplier,
        balance,
        outstandingAmount,
        totalPaid,
        collectionSessions: toCollectionSessions(supplier),
      };
    })
  );
  
  return { rows: enrichedRows, meta: buildMeta(total, page, limit) };
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
    
    // Return enriched supplier with computed fields
    const { outstandingAmount } = await computeSupplierOutstanding(tenantId, supplierId, t);
    const balance = Number(updated.balance ?? 0);
    const totalPaid = Math.max(0, -balance + outstandingAmount);
    return {
      ...updated,
      balance,
      outstandingAmount,
      totalPaid,
      collectionSessions: toCollectionSessions(updated),
    };
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
    
    // Compute enriched supplier data
    const { outstandingAmount } = await computeSupplierOutstanding(tenantId, supplierId, t);
    const balance = Number(updated.balance ?? 0);
    const totalPaid = Math.max(0, -balance + outstandingAmount);
    const enrichedSupplier = {
      ...updated,
      balance,
      outstandingAmount,
      totalPaid,
      collectionSessions: toCollectionSessions(updated),
    };
    
    if (!isActive) {
      const unsettled = await countConfirmedUnsettled(tenantId, supplierId, t);
      if (unsettled > 0) {
        return {
          supplier: enrichedSupplier,
          warning: `Supplier has ${unsettled} confirmed-but-unsettled collection(s). Settle dues before deactivating.`,
        };
      }
    }
    return { supplier: enrichedSupplier };
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
