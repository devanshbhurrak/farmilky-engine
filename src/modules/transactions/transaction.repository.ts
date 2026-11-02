import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import {
  transactionItems,
  transactions,
} from '../../shared/db/schema/index.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';

export interface InsertTxnRow {
  tenantId: string;
  txnNumber: string;
  partyType: 'customer' | 'supplier' | 'business';
  partyId: string | null;
  txnType:
    | 'delivery'
    | 'order'
    | 'payment'
    | 'credit_adjustment'
    | 'debit_adjustment'
    | 'return_refund'
    | 'opening_balance'
    | 'milk_collection'
    | 'supplier_payment'
    | 'supplier_adjustment'
    | 'expense';
  txnCategory?: string | null;
  entryType: 'debit' | 'credit';
  amount: string;
  effectiveDate: string;
  referenceType?:
    | 'subscription_delivery'
    | 'delivery'
    | 'order'
    | 'milk_collection'
    | 'return'
    | 'invoice'
    | 'manual'
    | null;
  referenceId?: string | null;
  paymentMethod?: 'cash' | 'upi' | 'bank_transfer' | 'card' | 'online' | 'COD' | null;
  paymentRef?: string | null;
  receivedDate?: string | null;
  status?: 'active' | 'voided' | 'deleted';
  reconciled?: boolean;
  voidedByTxnId?: string | null;
  correctsTxnId?: string | null;
  voidReason?: string | null;
  description: string;
  notes?: string | null;
  createdById?: string | null;
  modifiedById?: string | null;
}

export async function insertTransaction(row: InsertTxnRow, tx: DrizzleTx) {
  const [created] = await tx.insert(transactions).values(row).returning();
  return created;
}

export async function insertTransactionItems(
  transactionId: string,
  items: Array<{
    description: string;
    productId?: string | null;
    productName?: string | null;
    variantLabel?: string | null;
    quantity?: string | null;
    unit?: string | null;
    rate?: string | null;
    amount: string;
    referenceType?: string | null;
    referenceId?: string | null;
    sortOrder?: number;
  }>,
  tx: DrizzleTx,
) {
  if (items.length === 0) return [];
  return tx
    .insert(transactionItems)
    .values(items.map((i) => ({ ...i, transactionId })))
    .returning();
}

export async function findTransactionById(id: string, tenantId: string, tx: DrizzleTx | DBOrTx = db) {
  const rows = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findActiveTransactionByRef(
  tenantId: string,
  referenceType: NonNullable<InsertTxnRow['referenceType']>,
  referenceId: string,
  tx: DrizzleTx | DBOrTx = db,
  entryType?: 'debit' | 'credit',
) {
  // Mirrors the subscription-delivery lookup: excludes reversal rows and
  // prefers the earliest charge so a re-record never voids a reversal.
  const conditions = [
    eq(transactions.tenantId, tenantId),
    eq(transactions.referenceType, referenceType),
    eq(transactions.referenceId, referenceId),
    eq(transactions.status, 'active' as const),
    sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.voided_by_txn_id = transactions.id)`,
  ];
  if (entryType) {
    conditions.push(eq(transactions.entryType, entryType));
  }
  const rows = await tx
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(transactions.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

export async function findItemsByTransactionId(transactionId: string, tx: DrizzleTx | DBOrTx = db) {
  return tx
    .select()
    .from(transactionItems)
    .where(eq(transactionItems.transactionId, transactionId))
    .orderBy(transactionItems.sortOrder);
}

export async function updateTransaction(
  id: string,
  tenantId: string,
  patch: Partial<InsertTxnRow> & { modifiedAt?: Date },
  tx: DrizzleTx,
) {
  const [updated] = await tx
    .update(transactions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
    .returning();
  return updated;
}

export interface HistoryFilters {
  startDate?: string;
  endDate?: string;
  txnType?: string;
}

export async function findActiveByParty(
  tenantId: string,
  partyType: 'customer' | 'supplier' | 'business',
  partyId: string | null,
  filters: HistoryFilters = {},
  pagination: { limit: number; offset: number } = { limit: 20, offset: 0 },
  dbOrTx: DBOrTx = db,
) {
  const conds = [
    eq(transactions.tenantId, tenantId),
    eq(transactions.partyType, partyType),
    eq(transactions.status, 'active' as const),
  ];
  if (partyId) conds.push(eq(transactions.partyId, partyId));
  if (filters.startDate) conds.push(gte(transactions.effectiveDate, filters.startDate));
  if (filters.endDate) conds.push(lte(transactions.effectiveDate, filters.endDate));
  if (filters.txnType) conds.push(eq(transactions.txnType, filters.txnType as never));

  const rows = await dbOrTx
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.effectiveDate), desc(transactions.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
  const [{ count }] = await dbOrTx
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(...conds));
  return { rows, total: count };
}

export async function findActiveByPartyAndPeriod(
  tenantId: string,
  partyType: 'customer' | 'supplier' | 'business',
  partyId: string,
  startDate: string,
  endDate: string,
  tx: DrizzleTx | DBOrTx = db,
) {
  return tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.partyType, partyType),
        eq(transactions.partyId, partyId),
        eq(transactions.status, 'active' as const),
        gte(transactions.effectiveDate, startDate),
        lte(transactions.effectiveDate, endDate),
      ),
    )
    .orderBy(desc(transactions.effectiveDate));
}

export async function sumActiveByParty(
  tenantId: string,
  partyType: 'customer' | 'supplier',
  partyId: string,
  dbOrTx: DBOrTx = db,
): Promise<number> {
  // Net balance from active transactions: customer debit - credit; supplier credit - debit
  const rows = await dbOrTx
    .select({
      total: sql<string>`COALESCE(SUM(CASE
        WHEN ${transactions.partyType} = 'customer' AND ${transactions.entryType} = 'debit' THEN ${transactions.amount}
        WHEN ${transactions.partyType} = 'customer' AND ${transactions.entryType} = 'credit' THEN -${transactions.amount}
        WHEN ${transactions.partyType} = 'supplier' AND ${transactions.entryType} = 'credit' THEN ${transactions.amount}
        WHEN ${transactions.partyType} = 'supplier' AND ${transactions.entryType} = 'debit' THEN -${transactions.amount}
        ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.partyType, partyType),
        eq(transactions.partyId, partyId),
        eq(transactions.status, 'active' as const),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}
