import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { transactionService, type CreateTxnParams } from '../transactions/transaction.service.js';
import { findPaymentById, listCustomerPassbook } from './payment.repository.js';
import type {
  DeletePaymentInput,
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
    const effectiveDate = input.receivedDate ?? toDateOnlyString(istToday());
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
        paymentRef: input.paymentRef ?? null,
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
    if (input.receivedDate !== undefined) {
      patch.effectiveDate = input.receivedDate;
      patch.receivedDate = input.receivedDate;
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
      const mm = String(month).padStart(2, '0');
      startDate = `${year}-${mm}-01`;
      endDate = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
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
