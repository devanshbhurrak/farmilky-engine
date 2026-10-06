import { eq } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import { invoiceCounters, tenants, transactionCounters } from '../../shared/db/schema/index.js';
import type { DBOrTx } from '../../shared/types/index.js';

export async function findTenantBySlug(slug: string, dbOrTx: DBOrTx = db) {
  const rows = await dbOrTx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0];
}

export async function findTenantById(id: string, dbOrTx: DBOrTx = db) {
  const rows = await dbOrTx.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0];
}

export async function createTenant(
  data: typeof tenants.$inferInsert,
  dbOrTx: DBOrTx = db,
) {
  const rows = await dbOrTx.insert(tenants).values(data).returning();
  return rows[0]!;
}

export async function updateTenantById(
  id: string,
  data: Partial<typeof tenants.$inferInsert>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await dbOrTx
    .update(tenants)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tenants.id, id))
    .returning();
  return rows[0];
}

export async function seedTransactionCounters(
  tenantId: string,
  year: number,
  txnTypes: string[],
  dbOrTx: DBOrTx = db,
): Promise<void> {
  if (txnTypes.length === 0) return;
  const rows = txnTypes.map((txnType) => ({
    id: `${tenantId}:${txnType}:${year}`,
    seq: 0,
  }));
  await dbOrTx.insert(transactionCounters).values(rows).onConflictDoNothing();
}

export async function seedInvoiceCounter(
  tenantId: string,
  year: number,
  month: string,
  dbOrTx: DBOrTx = db,
): Promise<void> {
  const id = `${tenantId}:${year}-${month}`;
  await dbOrTx.insert(invoiceCounters).values({ id, seq: 0 }).onConflictDoNothing();
}
