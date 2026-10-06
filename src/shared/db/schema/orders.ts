import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { areas } from './areas.js';
import { products, productVariants } from './products.js';
import {
  billingModeEnum,
  deliveryAttemptStatusEnum,
  deliverySlotEnum,
  orderStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
} from './enums.js';

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    areaId: uuid('area_id').references(() => areas.id),
    assignedAgentId: uuid('assigned_agent_id').references(() => users.id),
    linkedSubscriptionId: uuid('linked_subscription_id'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    paymentStatus: paymentStatusEnum('payment_status').notNull().default('pending'),
    orderStatus: orderStatusEnum('order_status').notNull().default('placed'),
    paymentMethod: paymentMethodEnum('payment_method').notNull().default('COD'),
    billingMode: billingModeEnum('billing_mode').notNull().default('pay_at_delivery'),
    paymentGatewayRef: text('payment_gateway_ref'),
    orderDate: date('order_date').notNull().defaultNow(),
    deliveryDate: date('delivery_date'),
    deliverySlot: deliverySlotEnum('delivery_slot'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    addressStreet: text('address_street'),
    addressCity: text('address_city'),
    addressState: text('address_state'),
    addressPincode: text('address_pincode'),
    addressLat: numeric('address_lat', { precision: 10, scale: 7 }),
    addressLng: numeric('address_lng', { precision: 10, scale: 7 }),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('orders_tenant_user_idx').on(t.tenantId, t.userId, t.createdAt),
    index('orders_tenant_status_idx').on(t.tenantId, t.orderStatus, t.createdAt),
    index('orders_tenant_area_idx').on(t.tenantId, t.areaId, t.orderStatus),
    index('orders_tenant_order_date_idx').on(t.tenantId, t.orderDate),
    index('orders_delivery_slot_idx').on(t.tenantId, t.deliveryDate, t.deliverySlot),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    productName: text('product_name').notNull(),
    variantLabel: text('variant_label'),
    unit: text('unit'),
    quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    originalPrice: numeric('original_price', { precision: 10, scale: 2 }),
    imageUrl: text('image_url'),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    check('order_items_qty_check', sql`${t.quantity} > 0`),
  ],
);

export const orderDeliveryAttempts = pgTable(
  'order_delivery_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    attemptDate: date('attempt_date').notNull().defaultNow(),
    status: deliveryAttemptStatusEnum('status').notNull(),
    reason: text('reason'),
    notes: text('notes'),
    handledById: uuid('handled_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_attempts_order_idx').on(t.orderId)],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderDeliveryAttempt = typeof orderDeliveryAttempts.$inferSelect;
