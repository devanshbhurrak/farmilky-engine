import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleTx } from '../../shared/types/index.js';
import { transactionSettlements, transactions } from '../../shared/db/schema/index.js';

export interface SettlementRow {
  id: string;
  tenantId: string;
  settlementTxnId: string;
  settledTxnId: string;
  amount: string;
  status: string;
  reversedAt: Date | null;
  reversedByTxnId: string | null;
  notes: string | null;
  createdAt: Date;
}

export async function insertSettlementRecord(
  tenantId: string,
  settlementTxnId: string,
  settledTxnId: string,
  amount: string,
  tx: DrizzleTx,
  notes?: string | null,
) {
  const rows = await tx
    .insert(transactionSettlements)
    .values({
      tenantId,
      settlementTxnId,
      settledTxnId,
      amount,
      status: 'active',
      notes: notes ?? null,
    })
    .returning();
  return rows[0]!;
}

export async function findActiveSettlementsForDebit(
  tenantId: string,
  settledTxnId: string,
  tx: DrizzleTx,
): Promise<SettlementRow[]> {
  return tx
    .select()
    .from(transactionSettlements)
    .where(
      and(
        eq(transactionSettlements.tenantId, tenantId),
        eq(transactionSettlements.settledTxnId, settledTxnId),
        eq(transactionSettlements.status, 'active'),
      ),
    );
}

export async function findActiveSettlementsForCredit(
  tenantId: string,
  settlementTxnId: string,
  tx: DrizzleTx,
): Promise<SettlementRow[]> {
  return tx
    .select()
    .from(transactionSettlements)
    .where(
      and(
        eq(transactionSettlements.tenantId, tenantId),
        eq(transactionSettlements.settlementTxnId, settlementTxnId),
        eq(transactionSettlements.status, 'active'),
      ),
    );
}

export async function findSettlementSummaryForDebits(
  tenantId: string,
  debitTxnIds: string[],
  tx: DrizzleTx,
): Promise<Map<string, number>> {
  if (debitTxnIds.length === 0) return new Map();
  const rows = await tx
    .select({
      settledTxnId: transactionSettlements.settledTxnId,
      totalSettled: sql<string>`coalesce(sum(${transactionSettlements.amount}), 0)`,
    })
    .from(transactionSettlements)
    .where(
      and(
        eq(transactionSettlements.tenantId, tenantId),
        eq(transactionSettlements.status, 'active'),
        inArray(transactionSettlements.settledTxnId, debitTxnIds),
      ),
    )
    .groupBy(transactionSettlements.settledTxnId);

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.settledTxnId, Number(r.totalSettled));
  }
  return map;
}

export async function markSettlementReversed(
  settlementId: string,
  tenantId: string,
  reversedByTxnId: string | null,
  notes: string,
  tx: DrizzleTx,
) {
  return tx
    .update(transactionSettlements)
    .set({
      status: 'reversed',
      reversedAt: new Date(),
      reversedByTxnId,
      notes,
    })
    .where(
      and(
        eq(transactionSettlements.id, settlementId),
        eq(transactionSettlements.tenantId, tenantId),
        eq(transactionSettlements.status, 'active'),
      ),
    );
}

export async function lockTransactionsForUpdate(
  tenantId: string,
  txnIds: string[],
  tx: DrizzleTx,
) {
  if (txnIds.length === 0) return [];
  return tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), inArray(transactions.id, txnIds)))
    .for('update');
}

