import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import {
  subscriptionChanges,
  subscriptionDeliveries,
  subscriptions,
  transactions,
  users,
} from '../../shared/db/schema/index.js';

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionInsert = typeof subscriptions.$inferInsert;
export type DeliveryInsert = typeof subscriptionDeliveries.$inferInsert;
export type ChangeInsert = typeof subscriptionChanges.$inferInsert;

// ---------- subscriptions ----------

export async function insertSubscription(
  tenantId: string,
  data: Omit<SubscriptionInsert, 'tenantId'>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(subscriptions)
    .values({ ...data, tenantId })
    .returning();
  return rows[0]!;
}

export async function findSubscriptionById(tenantId: string, id: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, id)))
    .limit(1);
  return rows[0];
}

export async function listSubscriptionsByUser(
  tenantId: string,
  userId: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.userId, userId)))
    .orderBy(desc(subscriptions.createdAt));
}

export async function listActiveSubscriptionsByUser(
  tenantId: string,
  userId: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, tenantId),
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, 'active'),
      ),
    )
    .orderBy(subscriptions.nextDeliveryDate);
}

export async function listActiveSubscriptionsDue(
  tenantId: string,
  opts: { maxNextDate: string; slot?: 'morning' | 'evening' },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(subscriptions.tenantId, tenantId),
    eq(subscriptions.status, 'active'),
    lte(subscriptions.nextDeliveryDate, opts.maxNextDate),
  ];
  if (opts.slot) conditions.push(eq(subscriptions.deliverySlot, opts.slot));
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptions)
    .where(and(...conditions))
    .orderBy(subscriptions.nextDeliveryDate, subscriptions.deliverySlot);
}

export async function listSubscriptionsAdmin(
  tenantId: string,
  filters: { status?: 'active' | 'paused' | 'cancelled'; search?: string },
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(subscriptions.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(subscriptions.status, filters.status));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(
      or(ilike(users.name, q), ilike(users.phone, q), ilike(users.email, q))!,
    );
  }
  return (dbOrTx as typeof db)
    .select({
      subscription: subscriptions,
      customerName: users.name,
      customerPhone: users.phone,
      customerEmail: users.email,
    })
    .from(subscriptions)
    .leftJoin(users, eq(users.id, subscriptions.userId))
    .where(and(...conditions))
    .orderBy(desc(subscriptions.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
}

export async function countSubscriptionsAdmin(
  tenantId: string,
  filters: { status?: 'active' | 'paused' | 'cancelled'; search?: string },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(subscriptions.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(subscriptions.status, filters.status));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(
      or(ilike(users.name, q), ilike(users.phone, q), ilike(users.email, q))!,
    );
  }
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(subscriptions)
    .leftJoin(users, eq(users.id, subscriptions.userId))
    .where(and(...conditions));
  return rows[0]?.value ?? 0;
}

export async function updateSubscriptionRow(
  tenantId: string,
  id: string,
  patch: Partial<SubscriptionInsert>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(subscriptions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.id, id)))
    .returning();
  return rows[0];
}

// ---------- deliveries ----------

export async function findDeliveryBySubscriptionAndDate(
  tenantId: string,
  subscriptionId: string,
  deliveryDate: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(
      and(
        eq(subscriptionDeliveries.tenantId, tenantId),
        eq(subscriptionDeliveries.subscriptionId, subscriptionId),
        eq(subscriptionDeliveries.deliveryDate, deliveryDate),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function findDeliveryById(
  tenantId: string,
  subscriptionId: string,
  entryId: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(
      and(
        eq(subscriptionDeliveries.tenantId, tenantId),
        eq(subscriptionDeliveries.subscriptionId, subscriptionId),
        eq(subscriptionDeliveries.id, entryId),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertDelivery(
  tenantId: string,
  data: Omit<DeliveryInsert, 'tenantId'>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(subscriptionDeliveries)
    .values({ ...data, tenantId })
    .returning();
  return rows[0]!;
}

export async function deleteDeliveryRow(tenantId: string, entryId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .delete(subscriptionDeliveries)
    .where(
      and(eq(subscriptionDeliveries.tenantId, tenantId), eq(subscriptionDeliveries.id, entryId)),
    )
    .returning({ id: subscriptionDeliveries.id });
  return rows[0];
}

export async function listDeliveriesBySubscription(
  tenantId: string,
  subscriptionId: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(
      and(
        eq(subscriptionDeliveries.tenantId, tenantId),
        eq(subscriptionDeliveries.subscriptionId, subscriptionId),
      ),
    )
    .orderBy(desc(subscriptionDeliveries.deliveryDate));
}

export async function listFutureDeliveriesFrom(
  tenantId: string,
  subscriptionId: string,
  fromDate: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(
      and(
        eq(subscriptionDeliveries.tenantId, tenantId),
        eq(subscriptionDeliveries.subscriptionId, subscriptionId),
        gte(subscriptionDeliveries.deliveryDate, fromDate),
      ),
    )
    .orderBy(subscriptionDeliveries.deliveryDate);
}

// ---------- changes audit ----------

export async function insertSubscriptionChange(
  tenantId: string,
  data: Omit<ChangeInsert, 'tenantId'>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(subscriptionChanges)
    .values({ ...data, tenantId })
    .returning();
  return rows[0]!;
}

export async function listSubscriptionChanges(
  tenantId: string,
  subscriptionId: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionChanges)
    .where(
      and(
        eq(subscriptionChanges.tenantId, tenantId),
        eq(subscriptionChanges.subscriptionId, subscriptionId),
      ),
    )
    .orderBy(desc(subscriptionChanges.createdAt));
}

// ---------- linked ledger transactions ----------

export async function findActiveTransactionByReference(
  tenantId: string,
  referenceType: 'subscription_delivery',
  referenceId: string,
  dbOrTx: DBOrTx = db,
) {
  // Excludes reversal rows (a reversal's id is referenced by the voided
  // original's voided_by_txn_id) and prefers the earliest charge, so a
  // re-record never voids a reversal and double-applies the balance.
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.referenceType, referenceType),
        eq(transactions.referenceId, referenceId),
        eq(transactions.status, 'active'),
        sql`NOT EXISTS (SELECT 1 FROM transactions r WHERE r.voided_by_txn_id = transactions.id)`,
      ),
    )
    .orderBy(transactions.createdAt)
    .limit(1);
  return rows[0] ?? null;
}
