import { sql } from 'drizzle-orm';
import { transactionCounters } from '../db/schema/index.js';
import type { DrizzleTx } from '../types/index.js';
import { istYear } from './dateUtils.js';

export const TXN_TYPE_CODES: Record<string, string> = {
  delivery: 'DLV',
  order: 'ORD',
  payment: 'PAY',
  credit_adjustment: 'CRD',
  debit_adjustment: 'DBT',
  return_refund: 'REF',
  opening_balance: 'OPN',
  milk_collection: 'MLK',
  supplier_payment: 'SUP',
  supplier_adjustment: 'ADJ',
  expense: 'EXP',
};

export async function generateTxnNumber(
  tenantId: string,
  txnType: string,
  tx: DrizzleTx,
): Promise<string> {
  const typeCode = TXN_TYPE_CODES[txnType] ?? 'GEN';
  const year = istYear();
  const counterId = `${tenantId}:${txnType}:${year}`;

  const rows = (await tx
    .insert(transactionCounters)
    .values({ id: counterId, seq: 1 })
    .onConflictDoUpdate({
      target: transactionCounters.id,
      set: { seq: sql`${transactionCounters.seq} + 1` },
    })
    .returning({ seq: transactionCounters.seq })) as Array<{ seq: number }>;

  const seq = rows[0]?.seq ?? 1;
  return `TXN-${typeCode}-${year}-${String(seq).padStart(6, '0')}`;
}
