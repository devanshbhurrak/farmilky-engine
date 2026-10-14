import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import { milkCollections, transactionSettlements, transactions } from '../../shared/db/schema/index.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';

export async function insertSettlement(
  tenantId: string,
  settlementTxnId: string,
  settledTxnId: string,
  amount: string,
  tx: DrizzleTx,
) {
  const [row] = await tx
    .insert(transactionSettlements)
    .values({ tenantId, settlementTxnId, settledTxnId, amount })
    .returning();
  return row!;
}

export async function findSettlementsForTxn(settledTxnId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(transactionSettlements)
    .where(eq(transactionSettlements.settledTxnId, settledTxnId));
}

export async function listSupplierHistoryTxns(
  tenantId: string,
  supplierId: string | undefined,
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const conds = [
    eq(transactions.tenantId, tenantId),
    eq(transactions.partyType, 'supplier'),
    ...(supplierId ? [eq(transactions.partyId, supplierId)] : []),
    eq(transactions.status, 'active'),
    inArray(transactions.txnType, ['supplier_payment', 'supplier_adjustment']),
  ];
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.effectiveDate), desc(transactions.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
  const [{ count }] = await (dbOrTx as typeof db)
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(...conds));
  return { rows, total: count };
}

export interface CollectionTotalFilters {
  supplierId?: string;
  startDate?: string;
  endDate?: string;
}

export async function summarizeCollectionTotal(tenantId: string, filters: CollectionTotalFilters, dbOrTx: DBOrTx = db) {
  const collConds = [eq(milkCollections.tenantId, tenantId), eq(milkCollections.status, 'confirmed' as const)];
  if (filters.supplierId) collConds.push(eq(milkCollections.supplierId, filters.supplierId));
  if (filters.startDate) collConds.push(gte(milkCollections.collectionDate, filters.startDate));
  if (filters.endDate) collConds.push(lte(milkCollections.collectionDate, filters.endDate));

  const [coll] = await (dbOrTx as typeof db)
    .select({
      total: sql<string>`COALESCE(SUM(${milkCollections.actualQty} * ${milkCollections.ratePerLiter}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(milkCollections)
    .where(and(...collConds));

  const adjConds = [
    eq(transactions.tenantId, tenantId),
    eq(transactions.partyType, 'supplier'),
    eq(transactions.txnType, 'supplier_adjustment'),
    eq(transactions.status, 'active' as const),
  ];
  if (filters.supplierId) adjConds.push(eq(transactions.partyId, filters.supplierId));
  if (filters.startDate) adjConds.push(gte(transactions.effectiveDate, filters.startDate));
  if (filters.endDate) adjConds.push(lte(transactions.effectiveDate, filters.endDate));

  const [adj] = await (dbOrTx as typeof db)
    .select({
      net: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.entryType} = 'credit' THEN ${transactions.amount} ELSE -${transactions.amount} END), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...adjConds));

  return {
    collectionCount: coll?.count ?? 0,
    adjustmentCount: adj?.count ?? 0,
    collectionTotal: Number(coll?.total ?? 0),
    adjustmentNet: Number(adj?.net ?? 0),
  };
}
