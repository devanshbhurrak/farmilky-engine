import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DrizzleTx } from '../../shared/types/index.js';
import { round2 } from '../../shared/utils/dateUtils.js';
import { transactions, transactionSettlements } from '../../shared/db/schema/index.js';
import {
  findActiveSettlementsForCredit,
  findActiveSettlementsForDebit,
  insertSettlementRecord,
  lockTransactionsForUpdate,
  markSettlementReversed,
} from './settlement.repository.js';

export interface SettlementAllocationResult {
  settlementTxnId: string;
  totalAllocated: number;
  unappliedAmount: number;
  allocations: Array<{
    settledTxnId: string;
    amount: number;
    debitRemaining: number;
    debitStatus: 'paid' | 'partially_paid';
  }>;
}

export class SettlementService {
  /**
   * Allocate payment targeting a specific debit transaction (e.g. at delivery time).
   * Invariant: Does NOT leak excess payment into unrelated debits. Any excess remains unapplied.
   */
  async allocateTargeted(
    tenantId: string,
    paymentTxnId: string,
    targetDebitTxnId: string,
    allocatedAmount: number,
    tx: DrizzleTx,
    notes?: string,
  ): Promise<SettlementAllocationResult> {
    const locked = await lockTransactionsForUpdate(tenantId, [paymentTxnId, targetDebitTxnId], tx);
    const payment = locked.find((t) => t.id === paymentTxnId);
    const debit = locked.find((t) => t.id === targetDebitTxnId);

    if (!payment) throw new AppError('Payment transaction not found for settlement', 404);
    if (!debit) throw new AppError('Target debit transaction not found for settlement', 404);

    if (payment.tenantId !== tenantId || debit.tenantId !== tenantId) {
      throw new AppError('Tenant mismatch in settlement', 403);
    }
    if (payment.partyId !== debit.partyId || payment.partyType !== debit.partyType) {
      throw new AppError('Party mismatch between payment and debit', 400);
    }
    if (payment.entryType !== 'credit') throw new AppError('Settlement payment must be a credit entry', 400);
    if (debit.entryType !== 'debit') throw new AppError('Settlement target must be a debit entry', 400);
    if (payment.status !== 'active') throw new AppError('Payment transaction is not active', 400);
    if (debit.status !== 'active') throw new AppError('Debit transaction is not active', 400);

    const paymentAmount = Number(payment.amount);
    const debitAmount = Number(debit.amount);

    // Existing active settlements on credit
    const creditSettlements = await findActiveSettlementsForCredit(tenantId, paymentTxnId, tx);
    const creditUsed = round2(creditSettlements.reduce((sum, s) => sum + Number(s.amount), 0));
    const creditAvailable = round2(paymentAmount - creditUsed);

    // Existing active settlements on debit
    const debitSettlements = await findActiveSettlementsForDebit(tenantId, targetDebitTxnId, tx);
    const debitPaid = round2(debitSettlements.reduce((sum, s) => sum + Number(s.amount), 0));
    const debitOutstanding = round2(debitAmount - debitPaid);

    if (creditAvailable <= 0) {
      throw new AppError('Payment is already fully settled', 409);
    }
    if (debitOutstanding <= 0) {
      throw new AppError('Target debit is already fully settled', 409);
    }

    const toApply = round2(Math.min(allocatedAmount, creditAvailable, debitOutstanding));
    if (toApply <= 0) {
      throw new AppError('Settlement amount must be positive and within remaining limits', 400);
    }

    await insertSettlementRecord(
      tenantId,
      paymentTxnId,
      targetDebitTxnId,
      toApply.toFixed(2),
      tx,
      notes ?? 'Targeted settlement',
    );

    const newDebitRemaining = round2(debitOutstanding - toApply);
    const debitStatus = newDebitRemaining === 0 ? 'paid' : 'partially_paid';
    const unappliedAmount = round2(creditAvailable - toApply);

    return {
      settlementTxnId: paymentTxnId,
      totalAllocated: toApply,
      unappliedAmount,
      allocations: [
        {
          settledTxnId: targetDebitTxnId,
          amount: toApply,
          debitRemaining: newDebitRemaining,
          debitStatus,
        },
      ],
    };
  }

  /**
   * Allocate payment using FIFO across all open customer debits (oldest first).
   * Settles previous-month dues before current-month dues.
   */
  async allocateFifo(
    tenantId: string,
    paymentTxnId: string,
    tx: DrizzleTx,
    maxAmountToAllocate?: number,
  ): Promise<SettlementAllocationResult> {
    const paymentRows = await lockTransactionsForUpdate(tenantId, [paymentTxnId], tx);
    const payment = paymentRows[0];
    if (!payment) throw new AppError('Payment transaction not found for settlement', 404);
    if (payment.entryType !== 'credit') throw new AppError('Payment must be a credit entry', 400);
    if (payment.status !== 'active') throw new AppError('Payment is not active', 400);
    if (!payment.partyId) throw new AppError('Payment partyId is missing', 400);

    const paymentAmount = Number(payment.amount);
    const creditSettlements = await findActiveSettlementsForCredit(tenantId, paymentTxnId, tx);
    const creditUsed = round2(creditSettlements.reduce((sum, s) => sum + Number(s.amount), 0));
    let remainingCredit = round2(
      Math.min(
        paymentAmount - creditUsed,
        maxAmountToAllocate != null ? maxAmountToAllocate : paymentAmount - creditUsed,
      ),
    );

    if (remainingCredit <= 0) {
      return {
        settlementTxnId: paymentTxnId,
        totalAllocated: 0,
        unappliedAmount: round2(paymentAmount - creditUsed),
        allocations: [],
      };
    }

    // Find all active debits for this customer, ordered chronologically (FIFO)
    const openDebits = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.partyType, payment.partyType),
          eq(transactions.partyId, payment.partyId),
          eq(transactions.entryType, 'debit'),
          eq(transactions.status, 'active'),
        ),
      )
      .orderBy(asc(transactions.effectiveDate), asc(transactions.createdAt))
      .for('update');

    const allocations: SettlementAllocationResult['allocations'] = [];
    let totalAllocated = 0;

    for (const debit of openDebits) {
      if (remainingCredit <= 0) break;
      const debitAmount = Number(debit.amount);
      const debitSettlements = await findActiveSettlementsForDebit(tenantId, debit.id, tx);
      const alreadyPaid = round2(debitSettlements.reduce((sum, s) => sum + Number(s.amount), 0));
      const outstanding = round2(debitAmount - alreadyPaid);

      if (outstanding <= 0) continue; // Already fully paid

      const apply = round2(Math.min(remainingCredit, outstanding));
      if (apply <= 0) continue;

      await insertSettlementRecord(
        tenantId,
        paymentTxnId,
        debit.id,
        apply.toFixed(2),
        tx,
        'FIFO settlement',
      );

      const debitRemaining = round2(outstanding - apply);
      const debitStatus = debitRemaining === 0 ? 'paid' : 'partially_paid';

      allocations.push({
        settledTxnId: debit.id,
        amount: apply,
        debitRemaining,
        debitStatus,
      });

      totalAllocated = round2(totalAllocated + apply);
      remainingCredit = round2(remainingCredit - apply);
    }

    const unappliedAmount = round2(paymentAmount - creditUsed - totalAllocated);

    return {
      settlementTxnId: paymentTxnId,
      totalAllocated,
      unappliedAmount,
      allocations,
    };
  }

  /**
   * Reverse all active settlements associated with a transaction (either credit or debit)
   * in an append-only, auditable manner (never physically delete rows).
   */
  async reverseSettlementsForTxn(
    tenantId: string,
    txnId: string,
    reversalTxnId: string | null,
    reason: string,
    tx: DrizzleTx,
  ) {
    const asCredit = await findActiveSettlementsForCredit(tenantId, txnId, tx);
    const asDebit = await findActiveSettlementsForDebit(tenantId, txnId, tx);

    for (const s of [...asCredit, ...asDebit]) {
      await markSettlementReversed(
        s.id,
        tenantId,
        reversalTxnId,
        `Reversed due to transaction modification: ${reason}`,
        tx,
      );
    }
  }

  /**
   * Compute exact payment status and remaining balance for a specific debit transaction.
   */
  async getDebitSettlementStatus(
    tenantId: string,
    debitTxnId: string,
    tx: DrizzleTx,
  ): Promise<{
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    status: 'paid' | 'partially_paid' | 'unpaid';
  }> {
    const rows = await tx
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(and(eq(transactions.tenantId, tenantId), eq(transactions.id, debitTxnId)))
      .limit(1);

    if (!rows[0]) throw new AppError('Transaction not found', 404);
    const totalAmount = Number(rows[0].amount);

    const settlements = await findActiveSettlementsForDebit(tenantId, debitTxnId, tx);
    const paidAmount = round2(settlements.reduce((sum, s) => sum + Number(s.amount), 0));
    const outstandingAmount = Math.max(0, round2(totalAmount - paidAmount));

    let status: 'paid' | 'partially_paid' | 'unpaid' = 'unpaid';
    if (outstandingAmount === 0 && paidAmount > 0) status = 'paid';
    else if (paidAmount > 0) status = 'partially_paid';

    return { totalAmount, paidAmount, outstandingAmount, status };
  }
}

export const settlementService = new SettlementService();

