import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { istToday, round2, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { transactionService, type CreateTxnParams } from '../transactions/transaction.service.js';
import {
  listExpenses as listExpenseRows,
  summarizeExpenses as summarizeExpenseRows,
} from './expense.repository.js';
import type {
  CreateExpenseInput,
  DeleteExpenseInput,
  ExpenseQuery,
  ExpenseSummaryQuery,
  UpdateExpenseInput,
} from './expense.schema.js';

export async function createExpense(
  tenantId: string,
  input: CreateExpenseInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) =>
    transactionService.createTransaction(
      {
        tenantId,
        partyType: 'business',
        partyId: null,
        txnType: 'expense',
        entryType: 'debit',
        txnCategory: input.category,
        amount: input.amount,
        effectiveDate: input.effectiveDate ?? input.date ?? toDateOnlyString(istToday()),
        paymentMethod: input.paymentMethod ?? null,
        paymentRef: input.receiptReference?.trim() || null,
        description: input.description,
        notes: input.notes ?? null,
        createdById: adminId,
      },
      t,
    );
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function updateExpense(
  expenseTxnId: string,
  tenantId: string,
  input: UpdateExpenseInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const { void_reason, category, ...rest } = input;
  const run = async (t: DrizzleTx) => {
    const patch: Partial<CreateTxnParams> = {};
    if (rest.amount !== undefined) patch.amount = rest.amount;
    if (rest.description !== undefined) patch.description = rest.description;
    if (rest.receiptReference !== undefined) {
      patch.paymentRef = rest.receiptReference.trim() || null;
    }
    if (rest.notes !== undefined) patch.notes = rest.notes;
    if (rest.effectiveDate !== undefined || rest.date !== undefined) {
      patch.effectiveDate = rest.effectiveDate ?? rest.date;
    }
    if (category !== undefined) patch.txnCategory = category;
    return transactionService.editTransaction(expenseTxnId, tenantId, patch, void_reason, adminId, t);
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function removeExpense(
  expenseTxnId: string,
  tenantId: string,
  input: DeleteExpenseInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) =>
    transactionService.deleteTransaction(expenseTxnId, tenantId, input.void_reason, adminId, t);
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function listExpenses(tenantId: string, query: ExpenseQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listExpenseRows(
    tenantId,
    {
      limit,
      offset,
      search: query.search,
      category: query.category,
      startDate: query.startDate,
      endDate: query.endDate,
    },
    dbOrTx,
  );
  return { rows, meta: buildMeta(total, page, limit) };
}

export async function expenseSummary(tenantId: string, query: ExpenseSummaryQuery, dbOrTx: DBOrTx = db) {
  const breakdown = await summarizeExpenseRows(
    tenantId,
    { startDate: query.startDate, endDate: query.endDate, category: query.category, search: query.search },
    dbOrTx,
  );
  const total = round2(breakdown.reduce((sum, r) => sum + r.total, 0));
  const count = breakdown.reduce((sum, r) => sum + r.count, 0);
  return { breakdown, total, count };
}
