import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { logger } from '../../shared/utils/logger.js';
import { round2 } from '../../shared/utils/dateUtils.js';
import { transactions, transactionSettlements } from '../../shared/db/schema/index.js';
import {
  findActiveSettlementsForCredit,
  findActiveSettlementsForDebit,
  insertSettlementRecord,
} from './settlement.repository.js';
import { settlementService } from './settlement.service.js';

export interface MigrationStats {
  tenantId: string;
  totalPaymentsFound: number;
  totalDirectMatches: number;
  totalFifoAllocated: number;
  totalUnapplied: number;
  errors: Array<{ paymentId: string; message: string }>;
}

/**
 * Safe, idempotent migration of historical customer payments into transaction_settlements.
 * 1. Checks remaining credit available on each payment before creating any settlements.
 * 2. Matches payments having direct referenceId='delivery' first.
 * 3. Applies FIFO allocation to remaining unallocated payments against open debits.
 * 4. Never over-settles or double-counts; logs any ambiguous items for review.
 */
export async function migrateCustomerSettlements(
  tenantId: string,
  options: { dryRun?: boolean; customerId?: string } = {},
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    tenantId,
    totalPaymentsFound: 0,
    totalDirectMatches: 0,
    totalFifoAllocated: 0,
    totalUnapplied: 0,
    errors: [],
  };

  const paymentConditions = [
    eq(transactions.tenantId, tenantId),
    eq(transactions.partyType, 'customer'),
    eq(transactions.txnType, 'payment'),
    eq(transactions.entryType, 'credit'),
    eq(transactions.status, 'active'),
  ];
  if (options.customerId) {
    paymentConditions.push(eq(transactions.partyId, options.customerId));
  }

  const payments = await db
    .select()
    .from(transactions)
    .where(and(...paymentConditions))
    .orderBy(asc(transactions.effectiveDate), asc(transactions.createdAt));

  stats.totalPaymentsFound = payments.length;

  for (const p of payments) {
    try {
      const res = await withTransaction(async (tx) => {
        const paymentAmount = Number(p.amount);
        const creditSettlements = await findActiveSettlementsForCredit(tenantId, p.id, tx);
        const creditUsed = round2(creditSettlements.reduce((s, row) => s + Number(row.amount), 0));
        let creditAvailable = round2(paymentAmount - creditUsed);

        if (creditAvailable <= 0) {
          return { direct: 0, fifo: 0, unapplied: 0 };
        }

        let directCount = 0;
        let fifoCount = 0;

        // Phase 1: Direct delivery reference matching
        if (p.referenceType === 'delivery' && p.referenceId) {
          const matchedDebits = await tx
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.tenantId, tenantId),
                eq(transactions.referenceType, 'delivery'),
                eq(transactions.referenceId, p.referenceId),
                eq(transactions.entryType, 'debit'),
                eq(transactions.status, 'active'),
              ),
            );

          if (matchedDebits[0]) {
            const debit = matchedDebits[0];
            const debitSettlements = await findActiveSettlementsForDebit(tenantId, debit.id, tx);
            const debitPaid = round2(debitSettlements.reduce((s, row) => s + Number(row.amount), 0));
            const debitOutstanding = round2(Number(debit.amount) - debitPaid);

            if (debitOutstanding > 0) {
              const apply = round2(Math.min(creditAvailable, debitOutstanding));
              if (apply > 0) {
                if (!options.dryRun) {
                  await insertSettlementRecord(
                    tenantId,
                    p.id,
                    debit.id,
                    apply.toFixed(2),
                    tx,
                    'Historical direct delivery migration',
                  );
                }
                directCount++;
                creditAvailable = round2(creditAvailable - apply);
              }
            }
          }
        }

        // Phase 2: FIFO allocation for remaining available credit
        if (creditAvailable > 0) {
          if (!options.dryRun) {
            const fifoRes = await settlementService.allocateFifo(tenantId, p.id, tx, creditAvailable);
            fifoCount = fifoRes.allocations.length;
            creditAvailable = fifoRes.unappliedAmount;
          }
        }

        return { direct: directCount, fifo: fifoCount, unapplied: creditAvailable };
      });

      stats.totalDirectMatches += res.direct;
      stats.totalFifoAllocated += res.fifo;
      stats.totalUnapplied += res.unapplied;
    } catch (err) {
      stats.errors.push({
        paymentId: p.id,
        message: err instanceof Error ? err.message : String(err),
      });
      logger.error({ err, paymentId: p.id, tenantId }, 'Error migrating customer payment settlement');
    }
  }

  return stats;
}

