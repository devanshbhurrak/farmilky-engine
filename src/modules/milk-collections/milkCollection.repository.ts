import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import {
  milkCollections,
  suppliers,
  transactionSettlements,
  transactions,
} from '../../shared/db/schema/index.js';
import type { DBOrTx } from '../../shared/types/index.js';

export interface NewCollectionRow {
  supplierId: string;
  collectionDate: string;
  session: 'morning' | 'evening';
  expectedQty?: string;
  ratePerLiter?: string;
}

/**
 * Shape returned to the frontend: camelCase aliases that match the
 * `MilkCollection` type in `farmilky-management-v2/src/types/supplier.ts`.
 * Numeric columns are returned as strings by Drizzle (numeric type);
 * the service layer converts them to numbers via `mapCollectionRow`.
 */
export interface CollectionRow {
  id: string;
  supplierId: string;
  supplierName: string | null;
  supplierPhone?: string | null;
  date: string;
  session: 'morning' | 'evening';
  expectedQty: string | null;
  actualQty: string | null;
  fatContent: string | null;
  snf: string | null;
  ratePerLiter: string | null;
  status: 'pending' | 'confirmed';
  confirmedById?: string | null;
  confirmedAt?: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

/** Subset returned by the history query (no confirmed-by/at or updatedAt). */
export interface HistoryCollectionRow extends CollectionRow {
  confirmedById: string | null;
  confirmedAt: Date | null;
  updatedAt: Date;
}

export async function findCollectionById(collectionId: string, tenantId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(milkCollections)
    .where(and(eq(milkCollections.id, collectionId), eq(milkCollections.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findBySupplierDateSession(
  tenantId: string,
  supplierId: string,
  collectionDate: string,
  session: 'morning' | 'evening',
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(milkCollections)
    .where(
      and(
        eq(milkCollections.tenantId, tenantId),
        eq(milkCollections.supplierId, supplierId),
        eq(milkCollections.collectionDate, collectionDate),
        eq(milkCollections.session, session),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertManyCollections(tenantId: string, rows: NewCollectionRow[], dbOrTx: DBOrTx = db) {
  if (rows.length === 0) return [];
  return (dbOrTx as typeof db)
    .insert(milkCollections)
    .values(
      rows.map((r) => ({
        tenantId,
        supplierId: r.supplierId,
        collectionDate: r.collectionDate,
        session: r.session,
        expectedQty: r.expectedQty ?? '0',
        ratePerLiter: r.ratePerLiter ?? '0',
        status: 'pending' as const,
      })),
    )
    .returning();
}

export async function updateCollectionRow(
  collectionId: string,
  patch: {
    status?: 'pending' | 'confirmed';
    actualQty?: string | null;
    ratePerLiter?: string;
    fatContent?: string | null;
    snf?: string | null;
    notes?: string | null;
    confirmedById?: string | null;
    confirmedAt?: Date | null;
  },
  dbOrTx: DBOrTx = db,
) {
  const [updated] = await (dbOrTx as typeof db)
    .update(milkCollections)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(milkCollections.id, collectionId))
    .returning();
  return updated ?? null;
}

export async function listCollectionsByDate(
  tenantId: string,
  collectionDate: string,
  dbOrTx: DBOrTx = db,
): Promise<CollectionRow[]> {
  return (dbOrTx as typeof db)
    .select({
      id: milkCollections.id,
      supplierId: milkCollections.supplierId,
      supplierName: suppliers.name,
      supplierPhone: suppliers.phone,
      date: milkCollections.collectionDate,
      session: milkCollections.session,
      expectedQty: milkCollections.expectedQty,
      actualQty: milkCollections.actualQty,
      fatContent: milkCollections.fatContent,
      snf: milkCollections.snf,
      ratePerLiter: milkCollections.ratePerLiter,
      status: milkCollections.status,
      confirmedById: milkCollections.confirmedById,
      confirmedAt: milkCollections.confirmedAt,
      notes: milkCollections.notes,
      createdAt: milkCollections.createdAt,
      updatedAt: milkCollections.updatedAt,
    })
    .from(milkCollections)
    .leftJoin(suppliers, eq(milkCollections.supplierId, suppliers.id))
    .where(and(eq(milkCollections.tenantId, tenantId), eq(milkCollections.collectionDate, collectionDate)))
    .orderBy(milkCollections.supplierId, milkCollections.session);
}

export async function listPendingByDate(
  tenantId: string,
  collectionDate: string,
  session: 'morning' | 'evening' | 'both',
  dbOrTx: DBOrTx = db,
) {
  const conds = [
    eq(milkCollections.tenantId, tenantId),
    eq(milkCollections.collectionDate, collectionDate),
    eq(milkCollections.status, 'pending' as const),
  ];
  if (session !== 'both') conds.push(eq(milkCollections.session, session));
  return (dbOrTx as typeof db)
    .select()
    .from(milkCollections)
    .where(and(...conds));
}

export interface HistoryFilters {
  supplierId?: string;
  startDate?: string;
  endDate?: string;
  status?: 'pending' | 'confirmed';
}

export async function listCollectionHistory(
  tenantId: string,
  filters: HistoryFilters,
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const conds = [eq(milkCollections.tenantId, tenantId)];
  if (filters.supplierId) conds.push(eq(milkCollections.supplierId, filters.supplierId));
  if (filters.status) conds.push(eq(milkCollections.status, filters.status));
  if (filters.startDate) conds.push(gte(milkCollections.collectionDate, filters.startDate));
  if (filters.endDate) conds.push(lte(milkCollections.collectionDate, filters.endDate));

  const rows = await (dbOrTx as typeof db)
    .select({
      id: milkCollections.id,
      supplierId: milkCollections.supplierId,
      supplierName: suppliers.name,
      date: milkCollections.collectionDate,
      session: milkCollections.session,
      expectedQty: milkCollections.expectedQty,
      actualQty: milkCollections.actualQty,
      fatContent: milkCollections.fatContent,
      snf: milkCollections.snf,
      ratePerLiter: milkCollections.ratePerLiter,
      status: milkCollections.status,
      notes: milkCollections.notes,
      createdAt: milkCollections.createdAt,
    })
    .from(milkCollections)
    .leftJoin(suppliers, eq(milkCollections.supplierId, suppliers.id))
    .where(and(...conds))
    .orderBy(desc(milkCollections.collectionDate), milkCollections.session)
    .limit(pagination.limit)
    .offset(pagination.offset);
  const [{ count }] = await (dbOrTx as typeof db)
    .select({ count: sql<number>`count(*)::int` })
    .from(milkCollections)
    .where(and(...conds));
  const [agg] = await (dbOrTx as typeof db)
    .select({
      totalLiters: sql<string>`COALESCE(SUM(${milkCollections.actualQty}), 0)`,
      totalAmount: sql<string>`COALESCE(SUM(${milkCollections.actualQty} * ${milkCollections.ratePerLiter}), 0)`,
      avgFat: sql<string | null>`AVG(${milkCollections.fatContent})`,
      avgSnf: sql<string | null>`AVG(${milkCollections.snf})`,
    })
    .from(milkCollections)
    .where(and(...conds));
  return {
    rows,
    total: count,
    aggregates: {
      totalLiters: Number(agg?.totalLiters ?? 0),
      totalAmount: Number(agg?.totalAmount ?? 0),
      avgFat: agg?.avgFat != null ? Number(agg.avgFat) : null,
      avgSnf: agg?.avgSnf != null ? Number(agg.avgSnf) : null,
    },
  };
}

export interface UnsettledItem {
  collectionId: string;
  supplierId: string;
  collectionDate: string;
  session: 'morning' | 'evening';
  actualQty: string | null;
  ratePerLiter: string;
  txnId: string;
  txnAmount: string;
}

/** Confirmed collections whose linked txn has no settlement rows. */
export async function listConfirmedUnsettled(tenantId: string, supplierId?: string, dbOrTx: DBOrTx = db) {
  const conds = [
    eq(milkCollections.tenantId, tenantId),
    eq(milkCollections.status, 'confirmed' as const),
    sql`${transactionSettlements.id} IS NULL`,
  ];
  if (supplierId) conds.push(eq(milkCollections.supplierId, supplierId));
  const rows = await (dbOrTx as typeof db)
    .select({
      collectionId: milkCollections.id,
      supplierId: milkCollections.supplierId,
      collectionDate: milkCollections.collectionDate,
      session: milkCollections.session,
      actualQty: milkCollections.actualQty,
      ratePerLiter: milkCollections.ratePerLiter,
      txnId: transactions.id,
      txnAmount: transactions.amount,
    })
    .from(milkCollections)
    .innerJoin(
      transactions,
      and(
        eq(transactions.referenceType, 'milk_collection'),
        eq(transactions.referenceId, milkCollections.id),
        eq(transactions.tenantId, tenantId),
        eq(transactions.status, 'active'),
      ),
    )
    .leftJoin(transactionSettlements, eq(transactionSettlements.settledTxnId, transactions.id))
    .where(and(...conds))
    .orderBy(milkCollections.collectionDate);
  return rows as UnsettledItem[];
}

/** Active linked txn for a collection, if any. */
export async function findActiveTxnForCollection(tenantId: string, collectionId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.referenceType, 'milk_collection'),
        eq(transactions.referenceId, collectionId),
        eq(transactions.status, 'active'),
        sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.voided_by_txn_id = transactions.id)`,
      ),
    )
    .orderBy(transactions.createdAt)
    .limit(1);
  return rows[0] ?? null;
}

export async function listCollectionsInRange(tenantId: string, startDate: string, endDate: string, dbOrTx: DBOrTx = db): Promise<CollectionRow[]> {
  return (dbOrTx as typeof db)
    .select({
      id: milkCollections.id,
      supplierId: milkCollections.supplierId,
      supplierName: suppliers.name,
      supplierPhone: suppliers.phone,
      date: milkCollections.collectionDate,
      session: milkCollections.session,
      expectedQty: milkCollections.expectedQty,
      actualQty: milkCollections.actualQty,
      fatContent: milkCollections.fatContent,
      snf: milkCollections.snf,
      ratePerLiter: milkCollections.ratePerLiter,
      status: milkCollections.status,
      confirmedById: milkCollections.confirmedById,
      confirmedAt: milkCollections.confirmedAt,
      notes: milkCollections.notes,
      createdAt: milkCollections.createdAt,
      updatedAt: milkCollections.updatedAt,
    })
    .from(milkCollections)
    .leftJoin(suppliers, eq(milkCollections.supplierId, suppliers.id))
    .where(
      and(
        eq(milkCollections.tenantId, tenantId),
        gte(milkCollections.collectionDate, startDate),
        lte(milkCollections.collectionDate, endDate),
      ),
    );
}
