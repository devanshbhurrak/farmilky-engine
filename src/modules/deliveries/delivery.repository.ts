import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import {
  deliveries,
  deliveryItems,
  orderDeliveryAttempts,
  orders,
  subscriptionDeliveries,
  subscriptions,
  transactionItems,
  transactions,
  users,
} from '../../shared/db/schema/index.js';
import { deliverySlotEnum } from '../../shared/db/schema/enums.js';
import type {
  Delivery,
  NewDelivery,
  DeliveryItem,
  NewDeliveryItem,
} from '../../shared/db/schema/index.js';

export type DeliveryStatus = (typeof deliveries.status.enumValues)[number];
export type DeliveryType = (typeof deliveries.type.enumValues)[number];
export type DeliveryPaymentMode = (typeof deliveries.paymentMode.enumValues)[number];
export type DeliveryPaymentStatus = (typeof deliveries.paymentStatus.enumValues)[number];

const ACTIVE = isNull(deliveries.deletedAt);

export function tx(dbOrTx: DBOrTx) {
  return dbOrTx as typeof db;
}

export async function insertDelivery(data: NewDelivery, dbOrTx: DBOrTx = db) {
  const rows = await tx(dbOrTx)
    .insert(deliveries)
    .values(data)
    .returning();
  return rows[0]!;
}

/**
 * Insert a delivery unless a row with the same `idempotencyKey` already
 * exists. Used when materializing scheduled (pending) deliveries so repeated
 * board loads never duplicate rows.
 */
export async function insertDeliveryIfAbsent(data: NewDelivery, dbOrTx: DBOrTx = db) {
  const rows = await tx(dbOrTx)
    .insert(deliveries)
    .values(data)
    .onConflictDoNothing({ target: deliveries.idempotencyKey })
    .returning({ id: deliveries.id });
  return rows[0] ?? null;
}

export async function insertDeliveryItems(
  deliveryId: string,
  items: Omit<NewDeliveryItem, 'deliveryId'>[],
  dbOrTx: DBOrTx = db,
) {
  if (items.length === 0) return [];
  return tx(dbOrTx)
    .insert(deliveryItems)
    .values(items.map((i) => ({ ...i, deliveryId })))
    .returning();
}

export async function deleteDeliveryItems(
  deliveryId: string,
  dbOrTx: DBOrTx = db,
) {
  return tx(dbOrTx).delete(deliveryItems).where(eq(deliveryItems.deliveryId, deliveryId));
}

export async function findDeliveryById(tenantId: string, id: string, dbOrTx: DBOrTx = db) {
  const rows = await tx(dbOrTx)
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.id, id), ACTIVE))
    .limit(1);
  return rows[0] ?? null;
}

export async function findDeliveryByIdempotencyKey(
  tenantId: string,
  key: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await tx(dbOrTx)
    .select()
    .from(deliveries)
    .where(
      and(eq(deliveries.tenantId, tenantId), eq(deliveries.idempotencyKey, key), ACTIVE),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findDeliveryByReference(
  tenantId: string,
  referenceType: string,
  referenceId: string,
  deliveryDate: string,
  deliverySlot?: (typeof deliverySlotEnum.enumValues)[number] | null,
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(deliveries.tenantId, tenantId),
    eq(deliveries.referenceType, referenceType),
    eq(deliveries.referenceId, referenceId),
    eq(deliveries.deliveryDate, deliveryDate),
    ACTIVE,
  ];
  if (deliverySlot) conditions.push(eq(deliveries.deliverySlot, deliverySlot as 'morning' | 'evening'));
  const rows = await tx(dbOrTx)
    .select()
    .from(deliveries)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Canonical delivery-ledger rows for a single date. Used to enrich the
 * subscription delivery board and to avoid re-materializing scheduled rows.
 */
export async function findDeliveryLedgerForDate(
  tenantId: string,
  date: string,
  type: DeliveryType = 'subscription',
  dbOrTx: DBOrTx = db,
) {
  return tx(dbOrTx)
    .select({
      id: deliveries.id,
      customerId: deliveries.customerId,
      referenceId: deliveries.referenceId,
      deliveryDate: deliveries.deliveryDate,
      deliverySlot: deliveries.deliverySlot,
      status: deliveries.status,
      scheduledQuantity: deliveries.scheduledQuantity,
      actualQuantity: deliveries.actualQuantity,
      notes: deliveries.notes,
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.tenantId, tenantId),
        eq(deliveries.type, type),
        eq(deliveries.deliveryDate, date),
        ACTIVE,
      ),
    )
    .orderBy(asc(deliveries.deliverySlot));
}

export async function findDeliveryWithItems(
  tenantId: string,
  id: string,
  dbOrTx: DBOrTx = db,
) {
  const [delivery] = await tx(dbOrTx)
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.id, id), ACTIVE))
    .limit(1);
  if (!delivery) return null;
  const items = await tx(dbOrTx)
    .select()
    .from(deliveryItems)
    .where(eq(deliveryItems.deliveryId, id))
    .orderBy(asc(deliveryItems.id));
  return { delivery, items };
}

/**
 * Optimistic update: only succeeds if the current `version` matches
 * `expectedVersion`. Increments `version` on success. Returns null when the
 * record was concurrently modified (caller must retry or surface a conflict).
 */
export async function updateDeliveryOptimistic(
  tenantId: string,
  id: string,
  patch: Partial<NewDelivery>,
  expectedVersion: number,
  dbOrTx: DBOrTx = db,
) {
  const rows = await tx(dbOrTx)
    .update(deliveries)
    .set({ ...patch, version: sql`${deliveries.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(deliveries.tenantId, tenantId),
        eq(deliveries.id, id),
        ACTIVE,
        eq(deliveries.version, expectedVersion),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function softDeleteDelivery(
  tenantId: string,
  id: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await tx(dbOrTx)
    .update(deliveries)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.id, id), ACTIVE))
    .returning({ id: deliveries.id });
  return rows[0];
}

export interface DeliveryListFilters {
  customerId?: string | null;
  type?: DeliveryType | null;
  status?: DeliveryStatus | null;
  paymentStatus?: DeliveryPaymentStatus | null;
  date?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  slot?: (typeof deliverySlotEnum.enumValues)[number] | null;
  search?: string | null;
}

export async function listDeliveries(
  tenantId: string,
  filters: DeliveryListFilters,
  pagination: { limit: number; offset: number; sortBy?: string; sortOrder?: 'asc' | 'desc' },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(deliveries.tenantId, tenantId), ACTIVE];
  if (filters.customerId) conditions.push(eq(deliveries.customerId, filters.customerId));
  if (filters.type) conditions.push(eq(deliveries.type, filters.type));
  if (filters.status) conditions.push(eq(deliveries.status, filters.status));
  if (filters.paymentStatus) conditions.push(eq(deliveries.paymentStatus, filters.paymentStatus));
  if (filters.date) conditions.push(eq(deliveries.deliveryDate, filters.date));
  if (filters.fromDate) conditions.push(gte(deliveries.deliveryDate, filters.fromDate));
  if (filters.toDate) conditions.push(lte(deliveries.deliveryDate, filters.toDate));
  if (filters.slot) conditions.push(eq(deliveries.deliverySlot, filters.slot));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(users.name, q),
        ilike(users.phone, q),
        ilike(deliveries.reason, q),
        ilike(deliveries.notes, q),
      )!,
    );
  }

  const sortColumn =
    pagination.sortBy === 'totalAmount'
      ? deliveries.totalAmount
      : pagination.sortBy === 'customerName'
        ? users.name
        : pagination.sortBy === 'createdAt'
          ? deliveries.createdAt
          : deliveries.deliveryDate;

  const baseQuery = tx(dbOrTx)
    .select({
      id: deliveries.id,
      tenantId: deliveries.tenantId,
      customerId: deliveries.customerId,
      type: deliveries.type,
      referenceType: deliveries.referenceType,
      referenceId: deliveries.referenceId,
      deliveryDate: deliveries.deliveryDate,
      deliverySlot: deliveries.deliverySlot,
      status: deliveries.status,
      scheduledQuantity: deliveries.scheduledQuantity,
      actualQuantity: deliveries.actualQuantity,
      pricePerPacket: deliveries.pricePerPacket,
      totalAmount: deliveries.totalAmount,
      paymentMode: deliveries.paymentMode,
      paymentStatus: deliveries.paymentStatus,
      reason: deliveries.reason,
      notes: deliveries.notes,
      handledById: deliveries.handledById,
      attemptedAt: deliveries.attemptedAt,
      deliveredAt: deliveries.deliveredAt,
      rescheduledFromId: deliveries.rescheduledFromId,
      rescheduleReason: deliveries.rescheduleReason,
      idempotencyKey: deliveries.idempotencyKey,
      version: deliveries.version,
      createdAt: deliveries.createdAt,
      updatedAt: deliveries.updatedAt,
      customerName: users.name,
      customerPhone: users.phone,
    })
    .from(deliveries)
    .leftJoin(users, eq(users.id, deliveries.customerId))
    .where(and(...conditions))
    .orderBy(pagination.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn))
    .limit(pagination.limit)
    .offset(pagination.offset);

  const rows = await baseQuery;
  const [{ count: total }] = await tx(dbOrTx)
    .select({ count: sql<number>`count(*)::int` })
    .from(deliveries)
    .leftJoin(users, eq(users.id, deliveries.customerId))
    .where(and(...conditions));
  return { items: rows, total: Number(total) };
}

/**
 * Pending subscription deliveries in an inclusive date range, enriched with
 * customer contact details. Rows already recorded in the legacy
 * `subscription_deliveries` table are excluded so agent-recorded outcomes are
 * never double-confirmed.
 */
export async function listPendingSubscriptionDeliveries(
  tenantId: string,
  fromDate: string,
  toDate: string,
  slot?: (typeof deliverySlotEnum.enumValues)[number] | null,
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(deliveries.tenantId, tenantId),
    ACTIVE,
    eq(deliveries.type, 'subscription'),
    eq(deliveries.status, 'pending'),
    gte(deliveries.deliveryDate, fromDate),
    lte(deliveries.deliveryDate, toDate),
    sql`NOT EXISTS (
      SELECT 1 FROM subscription_deliveries sd
      WHERE sd.tenant_id = ${deliveries.tenantId}
        AND sd.subscription_id = ${deliveries.referenceId}
        AND sd.delivery_date = ${deliveries.deliveryDate}
        AND sd.delivery_slot = ${deliveries.deliverySlot}
    )`,
  ];
  if (slot) conditions.push(eq(deliveries.deliverySlot, slot));

  return tx(dbOrTx)
    .select({
      id: deliveries.id,
      customerId: deliveries.customerId,
      customerName: users.name,
      customerPhone: users.phone,
      deliveryDate: deliveries.deliveryDate,
      deliverySlot: deliveries.deliverySlot,
      status: deliveries.status,
      scheduledQuantity: deliveries.scheduledQuantity,
      pricePerPacket: deliveries.pricePerPacket,
      referenceType: deliveries.referenceType,
      referenceId: deliveries.referenceId,
    })
    .from(deliveries)
    .leftJoin(users, eq(users.id, deliveries.customerId))
    .where(and(...conditions))
    .orderBy(
      asc(deliveries.deliveryDate),
      asc(deliveries.deliverySlot),
      asc(users.deliverySequence),
      asc(users.name),
    );
}

export async function countDeliveriesForPeriod(
  tenantId: string,
  customerId: string,
  fromDate: string,
  toDate: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await tx(dbOrTx)
    .select({ count: sql<number>`count(*)::int` })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.tenantId, tenantId),
        eq(deliveries.customerId, customerId),
        ACTIVE,
        gte(deliveries.deliveryDate, fromDate),
        lte(deliveries.deliveryDate, toDate),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

export async function aggregateCustomerDeliveries(
  tenantId: string,
  customerId: string,
  fromDate: string,
  toDate: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await tx(dbOrTx)
    .select({
      status: deliveries.status,
      totalAmount: deliveries.totalAmount,
      scheduledQuantity: deliveries.scheduledQuantity,
      actualQuantity: deliveries.actualQuantity,
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.tenantId, tenantId),
        eq(deliveries.customerId, customerId),
        ACTIVE,
        gte(deliveries.deliveryDate, fromDate),
        lte(deliveries.deliveryDate, toDate),
      ),
    );
  let totalCharges = 0;
  let deliveredCount = 0;
  let missedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalScheduledQty = 0;
  let totalActualQty = 0;
  for (const r of rows) {
    const amt = Number(r.totalAmount ?? 0);
    totalScheduledQty += Number(r.scheduledQuantity ?? 0);
    if (r.actualQuantity != null) totalActualQty += Number(r.actualQuantity);
    switch (r.status) {
      case 'delivered':
      case 'partial':
      case 'extra':
        totalCharges += amt;
        deliveredCount += 1;
        break;
      case 'missed':
        missedCount += 1;
        break;
      case 'skipped':
        skippedCount += 1;
        break;
      case 'failed':
        failedCount += 1;
        break;
      default:
        break;
    }
  }
  return {
    totalCharges: Math.round(totalCharges * 100) / 100,
    deliveredCount,
    missedCount,
    skippedCount,
    failedCount,
    totalScheduledQty: Math.round(totalScheduledQty * 1000) / 1000,
    totalActualQty: Math.round(totalActualQty * 1000) / 1000,
    count: rows.length,
  };
}

/**
 * Mark deliveries still `pending` whose deliveryDate is on/before `cutoff` as
 * `missed` (returned for reporting; financial state is unchanged since no
 * chargeable outcome was recorded).
 */
export async function markMissedDeliveries(
  tenantId: string,
  cutoff: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await tx(dbOrTx)
    .update(deliveries)
    .set({ status: 'missed', reason: 'Not attempted by cutoff', updatedAt: new Date() })
    .where(
      and(
        eq(deliveries.tenantId, tenantId),
        ACTIVE,
        eq(deliveries.status, 'pending'),
        lte(deliveries.deliveryDate, cutoff),
      ),
    )
    .returning({ id: deliveries.id, customerId: deliveries.customerId, deliveryDate: deliveries.deliveryDate });
  return rows;
}

/**
 * All active (non-voided/deleted) debit transactions tied to a delivery
 * reference, used to compute the amount actually charged/collected.
 */
export async function findActiveChargeTransactionsForDelivery(
  tenantId: string,
  referenceType: 'delivery',
  referenceId: string,
  dbOrTx: DBOrTx = db,
) {
  return tx(dbOrTx)
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.referenceType, referenceType),
        eq(transactions.referenceId, referenceId),
        eq(transactions.status, 'active'),
        eq(transactions.entryType, 'debit'),
      ),
    )
    .orderBy(asc(transactions.createdAt));
}

export async function findActiveCreditTransactionsForDelivery(
  tenantId: string,
  referenceType: 'delivery',
  referenceId: string,
  dbOrTx: DBOrTx = db,
) {
  return tx(dbOrTx)
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.referenceType, referenceType),
        eq(transactions.referenceId, referenceId),
        eq(transactions.status, 'active'),
        eq(transactions.entryType, 'credit'),
      ),
    )
    .orderBy(asc(transactions.createdAt));
}

export async function linkOrderAttempt(
  orderId: string,
  attemptDate: string,
  status: (typeof orderDeliveryAttempts.status.enumValues)[number],
  reason: string | null | undefined,
  handledById: string | null | undefined,
  dbOrTx: DBOrTx = db,
) {
  const rows = await tx(dbOrTx)
    .insert(orderDeliveryAttempts)
    .values({ orderId, attemptDate, status, reason: reason ?? null, handledById: handledById ?? null })
    .returning();
  return rows[0]!;
}

// Re-export types for convenience.
export type { Delivery, NewDelivery, DeliveryItem, NewDeliveryItem };
