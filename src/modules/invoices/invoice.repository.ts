import { and, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import {
  invoiceLineItems,
  invoiceProductSummary,
  invoices,
  users,
} from '../../shared/db/schema/index.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';

export type InvoiceStatus = typeof invoices.$inferSelect.status;
export type InvoiceRow = typeof invoices.$inferSelect;

const VOIDISH: InvoiceStatus[] = ['void', 'cancelled'];

export interface AdminInvoiceFilters {
  status?: string;
  month?: number;
  year?: number;
  userId?: string;
  search?: string;
}

export interface InvoiceLineItemInput {
  entryDate?: string | null;
  description: string;
  category: 'subscription_delivery' | 'order' | 'payment' | 'adjustment' | 'credit';
  referenceId?: string | null;
  referenceType?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  amount: string;
  productName?: string | null;
  variantLabel?: string | null;
  unit?: string | null;
  entryType: 'debit' | 'credit';
}

export interface InvoiceSummaryInput {
  productId?: string | null;
  productName: string;
  variantLabel?: string | null;
  unit?: string | null;
  totalQuantity: string;
  avgRate?: string | null;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
}

export async function findByPeriod(
  tenantId: string,
  userId: string,
  month: number,
  year: number,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.userId, userId),
        eq(invoices.billingMonth, month),
        eq(invoices.billingYear, year),
        notInArray(invoices.status, VOIDISH),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findLatestNonVoid(
  tenantId: string,
  userId: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.userId, userId),
        notInArray(invoices.status, VOIDISH),
      ),
    )
    .orderBy(desc(invoices.billingYear), desc(invoices.billingMonth))
    .limit(1);
  return rows[0] ?? null;
}

export async function findPreviousNonVoid(
  tenantId: string,
  userId: string,
  month: number,
  year: number,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.userId, userId),
        notInArray(invoices.status, VOIDISH),
        or(
          sql`${invoices.billingYear} < ${year}`,
          and(eq(invoices.billingYear, year), sql`${invoices.billingMonth} < ${month}`),
        )!,
      ),
    )
    .orderBy(desc(invoices.billingYear), desc(invoices.billingMonth))
    .limit(1);
  return rows[0] ?? null;
}

export async function findById(tenantId: string, id: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByIdForUser(
  tenantId: string,
  userId: string,
  id: string,
  excludeVoided: boolean,
  dbOrTx: DBOrTx = db,
) {
  const conds = [eq(invoices.id, id), eq(invoices.tenantId, tenantId), eq(invoices.userId, userId)];
  if (excludeVoided) conds.push(notInArray(invoices.status, VOIDISH));
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(invoices)
    .where(and(...conds))
    .limit(1);
  return rows[0] ?? null;
}

async function buildAdminWhere(tenantId: string, filters: AdminInvoiceFilters, dbOrTx: DBOrTx) {
  const conds = [eq(invoices.tenantId, tenantId)];
  if (filters.status) conds.push(eq(invoices.status, filters.status as InvoiceStatus));
  if (filters.month !== undefined) conds.push(eq(invoices.billingMonth, filters.month));
  if (filters.year !== undefined) conds.push(eq(invoices.billingYear, filters.year));
  if (filters.userId) conds.push(eq(invoices.userId, filters.userId));
  if (filters.search && filters.search.trim() !== '') {
    const q = `%${filters.search.trim()}%`;
    const matched = await (dbOrTx as typeof db)
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          or(ilike(users.name, q), ilike(users.phone, q), ilike(users.email, q))!,
        ),
      )
      .limit(200);
    const ids = matched.map((m) => m.id);
    if (ids.length > 0) {
      conds.push(or(ilike(invoices.invoiceNumber, q), inArray(invoices.userId, ids))!);
    } else {
      conds.push(ilike(invoices.invoiceNumber, q));
    }
  }
  return and(...conds);
}

export async function listAdmin(
  tenantId: string,
  filters: AdminInvoiceFilters,
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const where = await buildAdminWhere(tenantId, filters, dbOrTx);
  const rows = await (dbOrTx as typeof db)
    .select({
      invoice: invoices,
      userName: users.name,
      userPhone: users.phone,
      userEmail: users.email,
    })
    .from(invoices)
    .leftJoin(users, and(eq(users.id, invoices.userId), eq(users.tenantId, tenantId)))
    .where(where)
    .orderBy(desc(invoices.billingYear), desc(invoices.billingMonth), desc(invoices.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(invoices)
    .where(where);
  return { rows, total };
}

export async function countAdmin(tenantId: string, filters: AdminInvoiceFilters, dbOrTx: DBOrTx = db) {
  const where = await buildAdminWhere(tenantId, filters, dbOrTx);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(invoices)
    .where(where);
  return total;
}

export async function listByUser(
  tenantId: string,
  userId: string,
  opts: { month?: number; year?: number; excludeVoided?: boolean },
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const conds = [eq(invoices.tenantId, tenantId), eq(invoices.userId, userId)];
  if (opts.excludeVoided !== false) conds.push(notInArray(invoices.status, VOIDISH));
  if (opts.month !== undefined) conds.push(eq(invoices.billingMonth, opts.month));
  if (opts.year !== undefined) conds.push(eq(invoices.billingYear, opts.year));
  const where = and(...conds);
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(invoices)
    .where(where)
    .orderBy(desc(invoices.billingYear), desc(invoices.billingMonth))
    .limit(pagination.limit)
    .offset(pagination.offset);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(invoices)
    .where(where);
  return { rows, total };
}

export async function insertInvoice(data: typeof invoices.$inferInsert, tx: DrizzleTx) {
  const rows = await tx.insert(invoices).values(data).returning();
  return rows[0]!;
}

export async function insertLineItems(invoiceId: string, items: InvoiceLineItemInput[], tx: DrizzleTx) {
  if (items.length === 0) return [];
  return tx
    .insert(invoiceLineItems)
    .values(items.map((i) => ({ ...i, invoiceId })))
    .returning();
}

export async function insertSummary(invoiceId: string, rows: InvoiceSummaryInput[], tx: DrizzleTx) {
  if (rows.length === 0) return [];
  return tx
    .insert(invoiceProductSummary)
    .values(rows.map((r) => ({ ...r, invoiceId })))
    .returning();
}

export async function findLineItems(invoiceId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));
}

export async function findSummary(invoiceId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(invoiceProductSummary)
    .where(eq(invoiceProductSummary.invoiceId, invoiceId));
}

export async function updateInvoice(
  tenantId: string,
  id: string,
  patch: Partial<typeof invoices.$inferInsert>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(invoices)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
    .returning();
  return rows[0] ?? null;
}
