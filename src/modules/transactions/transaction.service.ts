import { sql } from 'drizzle-orm';
import { withTransaction, type DrizzleTx } from '../../shared/db/transaction.js';
import { generateTxnNumber } from '../../shared/utils/txnNumber.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import {
  findItemsByTransactionId,
  findTransactionById,
  insertTransaction,
  insertTransactionItems,
  updateTransaction,
  type InsertTxnRow,
} from './transaction.repository.js';

export function computeDelta(partyType: string, entryType: string, amount: number): number {
  // customer: debit = +amount (they owe more), credit = -amount (they owe less)
  // supplier: credit = +amount (we owe more), debit = -amount (we owe less)
  if (partyType === 'customer') return entryType === 'debit' ? amount : -amount;
  if (partyType === 'supplier') return entryType === 'credit' ? amount : -amount;
  return 0;
}

export function flipEntry(e: string): 'debit' | 'credit' {
  return e === 'debit' ? 'credit' : 'debit';
}

export interface CreateTxnParams {
  tenantId: string;
  partyType: 'customer' | 'supplier' | 'business';
  partyId: string | null;
  txnType: InsertTxnRow['txnType'];
  txnCategory?: string | null;
  entryType: 'debit' | 'credit';
  amount: number;
  effectiveDate: string;
  referenceType?: InsertTxnRow['referenceType'];
  referenceId?: string | null;
  paymentMethod?: 'cash' | 'upi' | 'bank_transfer' | 'card' | 'online' | 'COD' | null;
  paymentRef?: string | null;
  receivedDate?: string | null;
  description: string;
  notes?: string | null;
  createdById?: string | null;
  items?: Array<{
    description: string;
    productId?: string | null;
    productName?: string | null;
    variantLabel?: string | null;
    quantity?: number | null;
    unit?: string | null;
    rate?: number | null;
    amount: number;
    referenceType?: string | null;
    referenceId?: string | null;
    sortOrder?: number;
  }>;
}

function toAmountString(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Amount must be positive', 400);
  return amount.toFixed(2);
}

export class TransactionService {
  async createTransaction(params: CreateTxnParams, tx?: DrizzleTx) {
    const run = async (t: DrizzleTx) => {
      const txnNumber = await generateTxnNumber(params.tenantId, params.txnType, t);
      const txn = await insertTransaction(
        {
          tenantId: params.tenantId,
          txnNumber,
          partyType: params.partyType,
          partyId: params.partyId,
          txnType: params.txnType,
          txnCategory: params.txnCategory ?? null,
          entryType: params.entryType,
          amount: toAmountString(params.amount),
          effectiveDate: params.effectiveDate,
          referenceType: params.referenceType ?? null,
          referenceId: params.referenceId ?? null,
          paymentMethod: params.paymentMethod ?? null,
          paymentRef: params.paymentRef ?? null,
          receivedDate: params.receivedDate ?? null,
          status: 'active',
          description: params.description,
          notes: params.notes ?? null,
          createdById: params.createdById ?? null,
        },
        t,
      );
      if (params.items?.length) {
        await insertTransactionItems(
          txn.id,
          params.items.map((i) => ({
            ...i,
            quantity: i.quantity != null ? String(i.quantity) : null,
            rate: i.rate != null ? String(i.rate) : null,
            amount: Number(i.amount).toFixed(2),
          })),
          t,
        );
      }
      await this.applyBalanceDelta(
        params.tenantId,
        params.partyType,
        params.partyId,
        params.entryType,
        params.amount,
        t,
      );
      return txn;
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  async voidTransaction(txnId: string, tenantId: string, reason: string, adminId: string, tx?: DrizzleTx) {
    const run = async (t: DrizzleTx) => {
      const original = await findTransactionById(txnId, tenantId, t);
      if (!original) throw new AppError('Transaction not found', 404);
      if (original.status !== 'active') throw new AppError('Transaction already voided/deleted', 400);
      if (!reason?.trim()) throw new AppError('void_reason is required', 400);

      const reversal = await this.createTransaction(
        {
          tenantId,
          partyType: original.partyType as CreateTxnParams['partyType'],
          partyId: original.partyId,
          txnType: original.txnType as CreateTxnParams['txnType'],
          txnCategory: original.txnCategory,
          entryType: flipEntry(original.entryType),
          amount: Number(original.amount),
          effectiveDate: original.effectiveDate,
          referenceType: original.referenceType,
          referenceId: original.referenceId,
          paymentMethod: original.paymentMethod,
          paymentRef: original.paymentRef,
          description: `Reversal of ${original.txnNumber}`,
          createdById: adminId,
        },
        t,
      );
      await updateTransaction(
        txnId,
        tenantId,
        {
          status: 'voided',
          voidedByTxnId: reversal.id,
          voidReason: reason,
          modifiedById: adminId,
          modifiedAt: new Date(),
        },
        t,
      );
      return reversal;
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  async editTransaction(
    txnId: string,
    tenantId: string,
    newParams: Partial<CreateTxnParams>,
    reason: string,
    adminId: string,
    tx?: DrizzleTx,
  ) {
    const run = async (t: DrizzleTx) => {
      const original = await findTransactionById(txnId, tenantId, t);
      if (!original) throw new AppError('Transaction not found', 404);
      if (original.status !== 'active') throw new AppError('Transaction already voided/deleted', 400);
      await this.voidTransaction(txnId, tenantId, reason, adminId, t);
      // Preserve product granularity: clone the original's line items unless
      // the caller explicitly supplies replacements.
      const items =
        newParams.items ??
        (await findItemsByTransactionId(txnId, t)).map((i) => ({
          description: i.description,
          productId: i.productId,
          productName: i.productName,
          variantLabel: i.variantLabel,
          quantity: i.quantity != null ? Number(i.quantity) : null,
          unit: i.unit,
          rate: i.rate != null ? Number(i.rate) : null,
          amount: Number(i.amount),
          referenceType: i.referenceType,
          referenceId: i.referenceId,
          sortOrder: i.sortOrder ?? 0,
        }));
      const created = await this.createTransaction(
        {
          tenantId,
          partyType: (newParams.partyType ?? original.partyType) as CreateTxnParams['partyType'],
          partyId: newParams.partyId !== undefined ? newParams.partyId : original.partyId,
          txnType: (newParams.txnType ?? original.txnType) as CreateTxnParams['txnType'],
          txnCategory: newParams.txnCategory !== undefined ? newParams.txnCategory : original.txnCategory,
          entryType: (newParams.entryType ?? original.entryType) as 'debit' | 'credit',
          amount: newParams.amount ?? Number(original.amount),
          effectiveDate: newParams.effectiveDate ?? original.effectiveDate,
          referenceType: newParams.referenceType !== undefined ? newParams.referenceType : original.referenceType,
          referenceId: newParams.referenceId !== undefined ? newParams.referenceId : original.referenceId,
          paymentMethod: newParams.paymentMethod !== undefined ? newParams.paymentMethod : original.paymentMethod,
          paymentRef: newParams.paymentRef !== undefined ? newParams.paymentRef : original.paymentRef,
          description: newParams.description ?? original.description,
          notes: newParams.notes !== undefined ? newParams.notes : original.notes,
          createdById: adminId,
          items,
        },
        t,
      );
      await updateTransaction(created.id, tenantId, { correctsTxnId: txnId }, t);
      return { ...created, correctsTxnId: txnId };
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  async deleteTransaction(txnId: string, tenantId: string, reason: string, adminId: string, tx?: DrizzleTx) {
    const run = async (t: DrizzleTx) => {
      const original = await findTransactionById(txnId, tenantId, t);
      if (!original) throw new AppError('Transaction not found', 404);
      if (original.status !== 'active') throw new AppError('Transaction already voided/deleted', 400);
      if (!reason?.trim()) throw new AppError('void_reason is required', 400);
      const reversal = await this.createTransaction(
        {
          tenantId,
          partyType: original.partyType as CreateTxnParams['partyType'],
          partyId: original.partyId,
          txnType: original.txnType as CreateTxnParams['txnType'],
          txnCategory: original.txnCategory,
          entryType: flipEntry(original.entryType),
          amount: Number(original.amount),
          effectiveDate: original.effectiveDate,
          referenceType: original.referenceType,
          referenceId: original.referenceId,
          description: `Deletion reversal of ${original.txnNumber}`,
          createdById: adminId,
        },
        t,
      );
      await updateTransaction(
        txnId,
        tenantId,
        {
          status: 'deleted',
          voidedByTxnId: reversal.id,
          voidReason: reason,
          modifiedById: adminId,
          modifiedAt: new Date(),
        },
        t,
      );
      return reversal;
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  private async applyBalanceDelta(
    tenantId: string,
    partyType: string,
    partyId: string | null,
    entryType: string,
    amount: number,
    tx: DrizzleTx,
  ) {
    if (partyType === 'business' || !partyId) return;
    const delta = computeDelta(partyType, entryType, amount);
    if (delta === 0) return;
    // Tenant-scoped with RETURNING: a 0-row update (deleted/wrong-tenant
    // party) throws instead of silently diverging ledger from balance cache.
    if (partyType === 'customer') {
      const rows = await tx.execute(
        sql`UPDATE users SET account_balance = account_balance + ${delta} WHERE id = ${partyId} AND tenant_id = ${tenantId} RETURNING id`,
      );
      if (resultRowCount(rows) === 0) {
        throw new AppError('Party not found for balance update', 404);
      }
    } else if (partyType === 'supplier') {
      const rows = await tx.execute(
        sql`UPDATE suppliers SET balance = balance + ${delta} WHERE id = ${partyId} AND tenant_id = ${tenantId} RETURNING id`,
      );
      if (resultRowCount(rows) === 0) {
        throw new AppError('Party not found for balance update', 404);
      }
    }
  }
}

function resultRowCount(result: unknown): number {
  const r = result as { rowCount?: number; count?: number; length?: number };
  if (typeof r?.rowCount === 'number') return r.rowCount;
  if (typeof r?.count === 'number') return r.count;
  if (Array.isArray(result)) return result.length;
  return 1;
}

export const transactionService = new TransactionService();
