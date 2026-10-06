import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { orderItems, orders, returnItems, returns } from '../../shared/db/schema/index.js';

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'completed';

export async function findOrderById(tenantId: string, orderId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findOrderItemsByOrderId(orderId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db).select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

export async function findActiveReturnForOrder(tenantId: string, orderId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(returns)
    .where(and(eq(returns.tenantId, tenantId), eq(returns.orderId, orderId), ne(returns.status, 'rejected')))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertReturn(
  tenantId: string,
  data: { orderId: string; userId: string; reason: string },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(returns)
    .values({ tenantId, orderId: data.orderId, userId: data.userId, reason: data.reason })
    .returning();
  return rows[0]!;
}

export interface NewReturnItem {
  orderItemId: string;
  quantity: string;
  unitPrice: string;
  productName: string;
  variantLabel?: string | null;
}

export async function insertReturnItems(returnId: string, items: NewReturnItem[], dbOrTx: DBOrTx = db) {
  if (items.length === 0) return [];
  return (dbOrTx as typeof db)
    .insert(returnItems)
    .values(items.map((i) => ({ ...i, returnId, variantLabel: i.variantLabel ?? null })))
    .returning();
}

export async function findReturnById(tenantId: string, returnId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(returns)
    .where(and(eq(returns.tenantId, tenantId), eq(returns.id, returnId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findReturnItemsByReturnId(returnId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db).select().from(returnItems).where(eq(returnItems.returnId, returnId));
}

export interface ReturnListOpts {
  limit: number;
  offset: number;
  status?: ReturnStatus;
}

export async function listReturnsByUser(
  tenantId: string,
  userId: string,
  opts: ReturnListOpts,
  dbOrTx: DBOrTx = db,
) {
  const conds = [eq(returns.tenantId, tenantId), eq(returns.userId, userId)];
  if (opts.status) conds.push(eq(returns.status, opts.status));
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(returns)
    .where(and(...conds))
    .orderBy(desc(returns.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(returns)
    .where(and(...conds));
  return { rows, total };
}

export async function listAllReturns(tenantId: string, opts: ReturnListOpts, dbOrTx: DBOrTx = db) {
  const conds = [eq(returns.tenantId, tenantId)];
  if (opts.status) conds.push(eq(returns.status, opts.status));
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(returns)
    .where(and(...conds))
    .orderBy(desc(returns.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(returns)
    .where(and(...conds));
  return { rows, total };
}

export async function updateReturnRow(
  tenantId: string,
  returnId: string,
  patch: {
    status?: ReturnStatus;
    adminNotes?: string | null;
    resolvedAt?: Date | null;
    resolvedById?: string | null;
  },
  dbOrTx: DBOrTx = db,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.adminNotes !== undefined) set.adminNotes = patch.adminNotes;
  if (patch.resolvedAt !== undefined) set.resolvedAt = patch.resolvedAt;
  if (patch.resolvedById !== undefined) set.resolvedById = patch.resolvedById;
  const rows = await (dbOrTx as typeof db)
    .update(returns)
    .set(set)
    .where(and(eq(returns.tenantId, tenantId), eq(returns.id, returnId)))
    .returning();
  return rows[0] ?? null;
}
