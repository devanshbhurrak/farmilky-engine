import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import {
  areas,
  orderItems,
  products,
  subscriptionChanges,
  subscriptionDeliveries,
  subscriptionSlots,
  subscriptions,
  transactions,
  userAddresses,
  users,
} from '../../shared/db/schema/index.js';

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionInsert = typeof subscriptions.$inferInsert;
export type SubscriptionSlotRow = typeof subscriptionSlots.$inferSelect;
export type SubscriptionSlotInsert = typeof subscriptionSlots.$inferInsert;
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
  if (opts.slot) {
    // Multi-slot aware: a subscription is due in a slot when it has a
    // subscription_slots row for it (single-slot legacy rows are backfilled).
    const slotMatch = (dbOrTx as typeof db)
      .select({ id: subscriptionSlots.id })
      .from(subscriptionSlots)
      .where(
        and(
          eq(subscriptionSlots.tenantId, tenantId),
          eq(subscriptionSlots.subscriptionId, subscriptions.id),
          eq(subscriptionSlots.deliverySlot, opts.slot),
        ),
      );
    conditions.push(exists(slotMatch));
  }
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptions)
    .where(and(...conditions))
    .orderBy(subscriptions.nextDeliveryDate, subscriptions.deliverySlot);
}

// ---------- per-slot config ----------

export async function insertSubscriptionSlots(
  tenantId: string,
  rows: Omit<SubscriptionSlotInsert, 'tenantId'>[],
  dbOrTx: DBOrTx = db,
) {
  if (rows.length === 0) return [];
  return (dbOrTx as typeof db)
    .insert(subscriptionSlots)
    .values(rows.map((r) => ({ ...r, tenantId })))
    .returning();
}

export async function listSubscriptionSlots(
  tenantId: string,
  subscriptionId: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionSlots)
    .where(
      and(
        eq(subscriptionSlots.tenantId, tenantId),
        eq(subscriptionSlots.subscriptionId, subscriptionId),
      ),
    )
    .orderBy(subscriptionSlots.deliverySlot);
}

export async function listSubscriptionSlotsForSubs(
  tenantId: string,
  subscriptionIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (subscriptionIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionSlots)
    .where(
      and(
        eq(subscriptionSlots.tenantId, tenantId),
        inArray(subscriptionSlots.subscriptionId, [...new Set(subscriptionIds)]),
      ),
    )
    .orderBy(subscriptionSlots.deliverySlot);
}

export async function updateSubscriptionSlotQty(
  tenantId: string,
  subscriptionId: string,
  slot: 'morning' | 'evening',
  quantityPerDelivery: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(subscriptionSlots)
    .set({ quantityPerDelivery, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptionSlots.tenantId, tenantId),
        eq(subscriptionSlots.subscriptionId, subscriptionId),
        eq(subscriptionSlots.deliverySlot, slot),
      ),
    )
    .returning();
  return rows[0];
}

export async function listSubscriptionsAdmin(
  tenantId: string,
  filters: {
    status?: 'active' | 'paused' | 'cancelled';
    search?: string;
    schedule?: 'daily' | 'alternate' | 'weekly' | 'custom';
    productId?: string;
  },
  pagination: {
    limit: number;
    offset: number;
    sortBy?: 'createdAt' | 'quantityPerDelivery' | 'pricePerPacket';
    sortOrder: 'asc' | 'desc';
  },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(subscriptions.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(subscriptions.status, filters.status));
  if (filters.schedule) conditions.push(eq(subscriptions.deliverySchedule, filters.schedule));
  if (filters.productId) conditions.push(eq(subscriptions.productId, filters.productId));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(
      or(ilike(users.name, q), ilike(users.phone, q), ilike(users.email, q))!,
    );
  }
  const sortColumn =
    pagination.sortBy === 'quantityPerDelivery'
      ? subscriptions.quantityPerDelivery
      : pagination.sortBy === 'pricePerPacket'
        ? subscriptions.pricePerPacket
        : subscriptions.createdAt;
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
    .orderBy(pagination.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn))
    .limit(pagination.limit)
    .offset(pagination.offset);
}

export async function countSubscriptionsAdmin(
  tenantId: string,
  filters: {
    status?: 'active' | 'paused' | 'cancelled';
    search?: string;
    schedule?: 'daily' | 'alternate' | 'weekly' | 'custom';
    productId?: string;
  },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(subscriptions.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(subscriptions.status, filters.status));
  if (filters.schedule) conditions.push(eq(subscriptions.deliverySchedule, filters.schedule));
  if (filters.productId) conditions.push(eq(subscriptions.productId, filters.productId));
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

export async function listSubscriptionsByIds(
  tenantId: string,
  ids: string[],
  dbOrTx: DBOrTx = db,
) {
  if (ids.length === 0) return [];
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptions)
    .where(
      and(eq(subscriptions.tenantId, tenantId), inArray(subscriptions.id, [...new Set(ids)])),
    );
}

export async function findSubscriptionDeliveriesForDate(
  tenantId: string,
  date: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(
      and(
        eq(subscriptionDeliveries.tenantId, tenantId),
        eq(subscriptionDeliveries.deliveryDate, date),
      ),
    );
}

export async function findDeliveryBySubscriptionAndDate(
  tenantId: string,
  subscriptionId: string,
  deliveryDate: string,
  slot?: 'morning' | 'evening',
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(subscriptionDeliveries.tenantId, tenantId),
    eq(subscriptionDeliveries.subscriptionId, subscriptionId),
    eq(subscriptionDeliveries.deliveryDate, deliveryDate),
  ];
  if (slot) conditions.push(eq(subscriptionDeliveries.deliverySlot, slot));
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(and(...conditions))
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

function deliveryHistoryConditions(
  tenantId: string,
  subscriptionId: string,
  filter: { month?: number; year?: number },
) {
  const conditions = [
    eq(subscriptionDeliveries.tenantId, tenantId),
    eq(subscriptionDeliveries.subscriptionId, subscriptionId),
  ];
  if (filter.year !== undefined) {
    conditions.push(gte(subscriptionDeliveries.deliveryDate, `${filter.year}-01-01`));
    conditions.push(lte(subscriptionDeliveries.deliveryDate, `${filter.year}-12-31`));
  }
  if (filter.month !== undefined && filter.year !== undefined) {
    const month = String(filter.month).padStart(2, '0');
    const nextMonthYear = filter.month === 12 ? filter.year + 1 : filter.year;
    const nextMonth = filter.month === 12 ? 1 : filter.month + 1;
    const nextMonthStart = [
      String(nextMonthYear).padStart(4, '0'),
      String(nextMonth).padStart(2, '0'),
      '01',
    ].join('-');
    conditions.push(gte(subscriptionDeliveries.deliveryDate, `${filter.year}-${month}-01`));
    conditions.push(lt(subscriptionDeliveries.deliveryDate, nextMonthStart));
  } else if (filter.month !== undefined) {
    conditions.push(
      sql`EXTRACT(MONTH FROM ${subscriptionDeliveries.deliveryDate}) = ${filter.month}`,
    );
  }
  return and(...conditions);
}

export async function listDeliveryHistoryPage(
  tenantId: string,
  subscriptionId: string,
  filter: { month?: number; year?: number; limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(deliveryHistoryConditions(tenantId, subscriptionId, filter))
    .orderBy(desc(subscriptionDeliveries.deliveryDate), desc(subscriptionDeliveries.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
}

export async function countDeliveryHistory(
  tenantId: string,
  subscriptionId: string,
  filter: { month?: number; year?: number },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select({ total: count() })
    .from(subscriptionDeliveries)
    .where(deliveryHistoryConditions(tenantId, subscriptionId, filter));
  return rows[0]?.total ?? 0;
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

// ---------- delivery board enrichment ----------

export async function findBoardUsers(
  tenantId: string,
  userIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (userIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      assignedAreaId: users.assignedAreaId,
      deliverySequence: users.deliverySequence,
    })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, [...new Set(userIds)])));
}

export async function findBoardAreas(
  tenantId: string,
  areaIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (areaIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(and(eq(areas.tenantId, tenantId), inArray(areas.id, [...new Set(areaIds)])));
}

export async function findBoardProducts(
  tenantId: string,
  productIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (productIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select({ id: products.id, name: products.name, unit: products.unit })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, [...new Set(productIds)])));
}

export async function findBoardAddresses(
  tenantId: string,
  userIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (userIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select()
    .from(userAddresses)
    .where(
      and(eq(userAddresses.tenantId, tenantId), inArray(userAddresses.userId, [...new Set(userIds)])),
    );
}

export async function findDeliveriesForDate(
  tenantId: string,
  subscriptionIds: string[],
  date: string,
  dbOrTx: DBOrTx = db,
) {
  if (subscriptionIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select()
    .from(subscriptionDeliveries)
    .where(
      and(
        eq(subscriptionDeliveries.tenantId, tenantId),
        eq(subscriptionDeliveries.deliveryDate, date),
        inArray(subscriptionDeliveries.subscriptionId, [...new Set(subscriptionIds)]),
      ),
    );
}

export async function findOrderItemsForBoard(
  _tenantId: string,
  orderIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (orderIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select({
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      productId: orderItems.productId,
      productName: orderItems.productName,
      unit: orderItems.unit,
      unitPrice: orderItems.unitPrice,
      variantId: orderItems.variantId,
      variantLabel: orderItems.variantLabel,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, [...new Set(orderIds)]));
}
