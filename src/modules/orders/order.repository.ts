import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import {
  areas,
  orderDeliveryAttempts,
  orderItems,
  orders,
  users,
} from '../../shared/db/schema/index.js';

export type Order = typeof orders.$inferSelect;

export type OrderStatus = (typeof orders.orderStatus.enumValues)[number];
export type PaymentStatus = (typeof orders.paymentStatus.enumValues)[number];
export type DeliverySlot = (typeof orders.deliverySlot.enumValues)[number];
export type PaymentMethod = (typeof orders.paymentMethod.enumValues)[number];
export type BillingMode = (typeof orders.billingMode.enumValues)[number];
export type AttemptStatus = (typeof orderDeliveryAttempts.status.enumValues)[number];

const PENDING_STATUSES = ['placed', 'confirmed'] as const;

export interface NewOrderRow {
  userId: string;
  areaId?: string | null;
  assignedAgentId?: string | null;
  totalAmount: string;
  paymentStatus?: PaymentStatus;
  orderStatus?: OrderStatus;
  paymentMethod?: PaymentMethod;
  billingMode?: BillingMode;
  orderDate?: string;
  deliveryDate?: string | null;
  deliverySlot?: DeliverySlot | null;
  deliveredAt?: Date | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPincode?: string | null;
  addressLat?: string | null;
  addressLng?: string | null;
  createdById?: string | null;
}

export interface NewOrderItemRow {
  productId?: string | null;
  variantId?: string | null;
  productName: string;
  variantLabel?: string | null;
  unit?: string | null;
  quantity: string;
  unitPrice: string;
  originalPrice?: string | null;
  imageUrl?: string | null;
}

export interface UpdateOrderPatch {
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  billingMode?: BillingMode;
  deliveryDate?: string | null;
  deliverySlot?: DeliverySlot | null;
  deliveredAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  assignedAgentId?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPincode?: string | null;
  addressLat?: string | null;
  addressLng?: string | null;
}

export interface NewAttemptRow {
  attemptDate: string;
  status: AttemptStatus;
  reason?: string | null;
  notes?: string | null;
  handledById?: string | null;
}

export async function insertOrder(tenantId: string, data: NewOrderRow, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .insert(orders)
    .values({ tenantId, ...data })
    .returning();
  return rows[0]!;
}

export async function insertOrderItems(orderId: string, items: NewOrderItemRow[], dbOrTx: DBOrTx = db) {
  if (items.length === 0) return [];
  return (dbOrTx as typeof db)
    .insert(orderItems)
    .values(items.map((i) => ({ ...i, orderId })))
    .returning();
}

export async function findOrderById(tenantId: string, orderId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  return rows[0];
}

export async function findOrderItems(orderId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
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
      unitPrice: orderItems.unitPrice,
      productId: orderItems.productId,
      variantId: orderItems.variantId,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      unit: orderItems.unit,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, [...new Set(orderIds)]));
}

export async function findAttemptsByOrder(orderId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(orderDeliveryAttempts)
    .where(eq(orderDeliveryAttempts.orderId, orderId))
    .orderBy(desc(orderDeliveryAttempts.createdAt));
}

export async function listOrdersByUser(
  tenantId: string,
  userId: string,
  opts: { limit: number; offset: number; status?: OrderStatus },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(orders.tenantId, tenantId), eq(orders.userId, userId)];
  if (opts.status) conditions.push(eq(orders.orderStatus, opts.status));
  return (dbOrTx as typeof db)
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function countOrdersByUser(
  tenantId: string,
  userId: string,
  opts: { status?: OrderStatus },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(orders.tenantId, tenantId), eq(orders.userId, userId)];
  if (opts.status) conditions.push(eq(orders.orderStatus, opts.status));
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(orders)
    .where(and(...conditions));
  return rows[0]?.value ?? 0;
}

function buildAdminConditions(tenantId: string, opts: { status?: OrderStatus; search?: string }) {
  const conditions = [eq(orders.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(orders.orderStatus, opts.status));
  if (opts.search) {
    const escaped = opts.search.replace(/[\\%_]/g, (m) => `\\${m}`);
    const like = `%${escaped}%`;
    conditions.push(
      or(
        ilike(users.name, like),
        ilike(users.phone, like),
        ilike(orders.addressPincode, like),
        ilike(orders.addressCity, like),
      )!,
    );
  }
  return conditions;
}

export async function listOrdersAdmin(
  tenantId: string,
  opts: { limit: number; offset: number; status?: OrderStatus; search?: string },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(and(...buildAdminConditions(tenantId, opts)))
    .orderBy(desc(orders.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r) => ({
    ...r.orders,
    customerName: r.users?.name ?? null,
    customerPhone: r.users?.phone ?? null,
  }));
}

export async function countOrdersAdmin(
  tenantId: string,
  opts: { status?: OrderStatus; search?: string },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(and(...buildAdminConditions(tenantId, opts)));
  return rows[0]?.value ?? 0;
}

export async function updateOrderRow(
  tenantId: string,
  orderId: string,
  patch: UpdateOrderPatch,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(orders)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .returning();
  return rows[0];
}

export async function insertDeliveryAttempt(
  orderId: string,
  data: NewAttemptRow,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(orderDeliveryAttempts)
    .values({ orderId, ...data })
    .returning();
  return rows[0]!;
}

export async function findPendingForDateSlot(
  tenantId: string,
  date: string,
  slot: DeliverySlot | undefined,
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(orders.tenantId, tenantId),
    eq(orders.deliveryDate, date),
    inArray(orders.orderStatus, [...PENDING_STATUSES]),
  ];
  if (slot) conditions.push(eq(orders.deliverySlot, slot));
  return (dbOrTx as typeof db)
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(orders.createdAt);
}

export async function findAreaByPincode(tenantId: string, pincode: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(areas)
    .where(
      and(
        eq(areas.tenantId, tenantId),
        isNull(areas.deletedAt),
        eq(areas.isActive, true),
        sql`${pincode} = ANY(${areas.pincodes})`,
      ),
    )
    .limit(1);
  return rows[0];
}

export async function decrementProductStockRow(
  tenantId: string,
  productId: string,
  qty: number,
  dbOrTx: DBOrTx = db,
) {
  const result = await (dbOrTx as typeof db).execute(
    sql`UPDATE products SET stock = stock - ${qty}, updated_at = NOW() WHERE id = ${productId} AND tenant_id = ${tenantId} AND stock >= ${qty} AND deleted_at IS NULL RETURNING id`,
  );
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as unknown[];
  return rows;
}

export async function incrementProductStockRow(
  tenantId: string,
  productId: string,
  qty: number,
  dbOrTx: DBOrTx = db,
) {
  const result = await (dbOrTx as typeof db).execute(
    sql`UPDATE products SET stock = stock + ${qty}, updated_at = NOW() WHERE id = ${productId} AND tenant_id = ${tenantId} AND deleted_at IS NULL RETURNING id`,
  );
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as unknown[];
  return rows;
}
