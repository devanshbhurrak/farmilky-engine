import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { transactionService, type CreateTxnParams } from '../transactions/transaction.service.js';
import { updateTransaction } from '../transactions/transaction.repository.js';
import {
  findPaymentById,
  listCustomerLedgerForPeriod,
  listCustomerPassbook,
} from './payment.repository.js';
import type {
  DeletePaymentInput,
  LedgerQuery,
  PassbookQuery,
  RecordPaymentInput,
  UpdatePaymentInput,
} from './payment.schema.js';

function fireInvoiceSync(tenantId: string, userId: string, effectiveDate?: string): void {
  try {
    const specifier = '../invoices/invoice.service.js';
    const pending: Promise<unknown> = import(specifier);
    void pending
      .then((m) => {
        const mod = m as {
          syncInvoiceStatusAfterPayment?: (tenantId: string, userId: string, effectiveDate?: string) => unknown;
        };
        try {
          mod.syncInvoiceStatusAfterPayment?.(tenantId, userId, effectiveDate);
        } catch {
          // invoice sync must never break the main flow
        }
      })
      .catch(() => undefined);
  } catch {
    // invoices module may not exist yet
  }
}

export async function recordPayment(
  tenantId: string,
  input: RecordPaymentInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  let syncUserId: string | null = null;
  let syncDate: string | undefined;
  const run = async (t: DrizzleTx) => {
    const effectiveDate = input.receivedDate ?? input.date ?? toDateOnlyString(istToday());
    const txn = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: input.userId,
        txnType: 'payment',
        entryType: 'credit',
        amount: input.amount,
        effectiveDate,
        receivedDate: effectiveDate,
        paymentMethod: input.paymentMethod ?? 'cash',
        paymentRef: input.paymentRef ?? input.transactionId ?? null,
        description: input.description ?? 'Payment received',
        notes: input.notes ?? null,
        createdById: adminId,
      },
      t,
    );
    syncUserId = input.userId;
    syncDate = effectiveDate;
    return txn;
  };
  const result = tx ? await run(tx) : await withTransaction(run);
  if (syncUserId) fireInvoiceSync(tenantId, syncUserId, syncDate);
  return result;
}

export async function updatePayment(
  paymentTxnId: string,
  tenantId: string,
  input: UpdatePaymentInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  let syncUserId: string | null = null;
  let syncDate: string | undefined;
  const run = async (t: DrizzleTx) => {
    const patch: Partial<CreateTxnParams> = {};
    if (input.amount !== undefined) patch.amount = input.amount;
    if (input.description !== undefined) patch.description = input.description;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.paymentMethod !== undefined) patch.paymentMethod = input.paymentMethod;
    const resolvedDate = input.receivedDate ?? input.date;
    if (resolvedDate !== undefined) {
      patch.effectiveDate = resolvedDate;
      patch.receivedDate = resolvedDate;
    }
    const updated = await transactionService.editTransaction(
      paymentTxnId,
      tenantId,
      patch,
      input.void_reason,
      adminId,
      t,
    );
    syncUserId = updated.partyId;
    syncDate = updated.effectiveDate;
    return updated;
  };
  const result = tx ? await run(tx) : await withTransaction(run);
  if (syncUserId) fireInvoiceSync(tenantId, syncUserId, syncDate);
  return result;
}

export async function deletePayment(
  paymentTxnId: string,
  tenantId: string,
  input: DeletePaymentInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  let syncUserId: string | null = null;
  let syncDate: string | undefined;
  const run = async (t: DrizzleTx) => {
    const original = await findPaymentById(paymentTxnId, tenantId, t);
    if (!original) throw new AppError('Payment transaction not found', 404);
    const result = await transactionService.deleteTransaction(
      paymentTxnId,
      tenantId,
      input.void_reason,
      adminId,
      t,
    );
    syncUserId = original.partyId;
    syncDate = original.effectiveDate;
    return result;
  };
  const result = tx ? await run(tx) : await withTransaction(run);
  if (syncUserId) fireInvoiceSync(tenantId, syncUserId, syncDate);
  return result;
}

/**
 * Manually confirm a UPI/bank-transfer payment (admin only). Sets the
 * `reconciled` flag on the active payment transaction.
 */
export async function reconcilePayment(
  paymentTxnId: string,
  tenantId: string,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const original = await findPaymentById(paymentTxnId, tenantId, t);
    if (!original) throw new AppError('Payment transaction not found', 404);
    if (original.status !== 'active') throw new AppError('Only active payments can be reconciled', 400);
    if (original.reconciled) return original;
    const updated = await updateTransaction(
      paymentTxnId,
      tenantId,
      { reconciled: true, modifiedById: adminId, modifiedAt: new Date() },
      t,
    );
    if (!updated) throw new AppError('Payment transaction not found', 404);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Inclusive first/last day of a calendar month, using UTC to avoid DST drift. */
function monthBounds(year: number, month: number): { startDate: string; endDate: string } {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export async function getPassbook(
  tenantId: string,
  userId: string,
  query: PassbookQuery,
  dbOrTx: DBOrTx = db,
) {
  const { page, limit, offset } = parsePagination(query);
  let startDate: string | undefined;
  let endDate: string | undefined;
  const year = query.year !== undefined ? Number(query.year) : undefined;
  const month = query.month !== undefined ? Number(query.month) : undefined;
  if (year !== undefined && Number.isFinite(year)) {
    if (month !== undefined && Number.isFinite(month)) {
      ({ startDate, endDate } = monthBounds(year, month));
    } else {
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }
  }
  const { rows, total } = await listCustomerPassbook(
    tenantId,
    userId,
    { startDate, endDate },
    { limit, offset },
    dbOrTx,
  );
  return { rows, meta: buildMeta(total, page, limit) };
}

/**
 * Full ledger for one customer and calendar month.
 *
 * Unlike the paginated passbook this returns every active transaction in the
 * period, so the UI can render an accurate month summary and never silently
 * drops entries after the first page.
 */
export async function getCustomerLedger(
  tenantId: string,
  userId: string,
  query: LedgerQuery,
  dbOrTx: DBOrTx = db,
) {
  const { startDate, endDate } = monthBounds(query.year, query.month);
  const rows = await listCustomerLedgerForPeriod(tenantId, userId, startDate, endDate, dbOrTx);

  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    if (row.entryType === 'debit') totalDebit += amount;
    else totalCredit += amount;
  }

  const debit = roundMoney(totalDebit);
  const credit = roundMoney(totalCredit);

  return {
    entries: rows,
    summary: {
      debit,
      credit,
      net: roundMoney(debit - credit),
      count: rows.length,
      period: { month: query.month, year: query.year, startDate, endDate },
    },
  };
}
