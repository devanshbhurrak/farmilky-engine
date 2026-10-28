import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { products, productVariants } from './products.js';
import {
  deliveryOutcomeEnum,
  deliveryPaymentModeEnum,
  deliveryPaymentStatusEnum,
  deliverySlotEnum,
  deliveryTypeEnum,
} from './enums.js';

/**
 * Canonical delivery ledger — one row per delivery event (per customer, per
 * date/slot), regardless of whether it originated from a subscription, a
 * one-time order, or an instant/rush delivery.
 *
 * This is the single source of truth for delivery status, quantities, money
 * owed, and reschedule history. Domain tables (subscription_deliveries,
 * order_delivery_attempts) remain as implementation details of their modules;
 * the deliveries module reconciles against them and never writes divergent
 * state.
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    type: deliveryTypeEnum('type').notNull(),
    // What this delivery fulfils. null for ad-hoc instant deliveries not tied
    // to a pre-existing order/subscription.
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    deliveryDate: date('delivery_date').notNull(),
    deliverySlot: deliverySlotEnum('delivery_slot'),
    status: deliveryOutcomeEnum('status').notNull().default('pending'),
    scheduledQuantity: numeric('scheduled_quantity', { precision: 10, scale: 3 }).notNull().default('0'),
    actualQuantity: numeric('actual_quantity', { precision: 10, scale: 3 }),
    pricePerPacket: numeric('price_per_packet', { precision: 10, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    paymentMode: deliveryPaymentModeEnum('payment_mode'),
    paymentStatus: deliveryPaymentStatusEnum('payment_status').notNull().default('pending'),
    reason: text('reason'),
    notes: text('notes'),
    handledById: uuid('handled_by_id').references(() => users.id),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    // Self-reference: when a delivery is rescheduled, the new record points
    // back at the original so the full reschedule chain is auditable.
    rescheduledFromId: uuid('rescheduled_from_id').references(
      (): AnyPgColumn => deliveries.id,
    ),
    rescheduleReason: text('reschedule_reason'),
    idempotencyKey: text('idempotency_key').unique(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('deliveries_tenant_customer_date_idx').on(t.tenantId, t.customerId, t.deliveryDate),
    index('deliveries_tenant_reference_idx').on(t.tenantId, t.referenceType, t.referenceId),
    index('deliveries_tenant_date_slot_status_idx').on(t.tenantId, t.deliveryDate, t.deliverySlot, t.status),
    index('deliveries_tenant_status_idx').on(t.tenantId, t.status),
    index('deliveries_rescheduled_from_idx').on(t.rescheduledFromId),
    check('deliveries_amount_nonneg', sql`${t.totalAmount} >= 0`),
    check('deliveries_scheduled_qty_nonneg', sql`${t.scheduledQuantity} >= 0`),
    check('deliveries_version_positive', sql`${t.version} > 0`),
  ],
);

export const deliveryItems = pgTable(
  'delivery_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    productName: text('product_name').notNull(),
    variantLabel: text('variant_label'),
    unit: text('unit'),
    quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    index('delivery_items_delivery_idx').on(t.deliveryId),
    index('delivery_items_product_idx').on(t.productId),
    check('delivery_items_qty_check', sql`${t.quantity} > 0`),
    check('delivery_items_amount_nonneg', sql`${t.amount} >= 0`),
  ],
);

export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
export type DeliveryItem = typeof deliveryItems.$inferSelect;
export type NewDeliveryItem = typeof deliveryItems.$inferInsert;
