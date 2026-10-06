import {
  boolean,
  check,
  date,
  index,
  jsonb,
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
  deliveryOutcomeEnum,
  deliveryScheduleEnum,
  deliverySlotEnum,
  subscriptionChangeTypeEnum,
  subscriptionStatusEnum,
} from './enums.js';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    areaId: uuid('area_id').references(() => areas.id),
    variantLabel: text('variant_label'),
    variantUnit: text('variant_unit'),
    variantQuantity: numeric('variant_quantity', { precision: 10, scale: 3 }),
    quantityPerDelivery: numeric('quantity_per_delivery', { precision: 10, scale: 3 }).notNull(),
    deliverySlot: deliverySlotEnum('delivery_slot').notNull(),
    deliverySchedule: deliveryScheduleEnum('delivery_schedule').notNull().default('daily'),
    customDays: text('custom_days').array().notNull().default([]),
    startDate: date('start_date').notNull().default(sql`CURRENT_DATE`),
    nextDeliveryDate: date('next_delivery_date').notNull(),
    pricePerPacket: numeric('price_per_packet', { precision: 10, scale: 2 }).notNull(),
    pricePerBaseUnit: numeric('price_per_base_unit', { precision: 10, scale: 2 }),
    totalPricePerDelivery: numeric('total_price_per_delivery', { precision: 10, scale: 2 }).notNull(),
    isCustomPrice: boolean('is_custom_price').notNull().default(false),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    pauseReason: text('pause_reason'),
    vacationFrom: date('vacation_from'),
    vacationUntil: date('vacation_until'),
    skippedDates: date('skipped_dates').array().notNull().default([]),
    scheduledQty: numeric('scheduled_qty', { precision: 10, scale: 3 }),
    scheduledPrice: numeric('scheduled_price', { precision: 10, scale: 2 }),
    scheduledChangeDate: date('scheduled_change_date'),
    scheduledEndDate: date('scheduled_end_date'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subs_tenant_user_status_idx').on(t.tenantId, t.userId, t.status),
    index('subs_tenant_status_next_idx').on(t.tenantId, t.status, t.nextDeliveryDate),
    index('subs_tenant_area_idx').on(t.tenantId, t.areaId),
    index('subs_tenant_next_slot_idx').on(t.tenantId, t.nextDeliveryDate, t.deliverySlot),
    check('subs_qty_check', sql`${t.quantityPerDelivery} > 0`),
  ],
);

export const subscriptionDeliveries = pgTable(
  'subscription_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    deliveryDate: date('delivery_date').notNull(),
    deliverySlot: deliverySlotEnum('delivery_slot').notNull(),
    status: deliveryOutcomeEnum('status').notNull(),
    scheduledQuantity: numeric('scheduled_quantity', { precision: 10, scale: 3 }).notNull(),
    actualQuantity: numeric('actual_quantity', { precision: 10, scale: 3 }),
    pricePerPacket: numeric('price_per_packet', { precision: 10, scale: 2 }).notNull(),
    pricePerBaseUnit: numeric('price_per_base_unit', { precision: 10, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    reason: text('reason'),
    notes: text('notes'),
    handledById: uuid('handled_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sub_deliv_sub_date_idx').on(t.tenantId, t.subscriptionId, t.deliveryDate),
    index('sub_deliv_date_slot_idx').on(t.tenantId, t.deliveryDate, t.deliverySlot, t.status),
  ],
);

export const subscriptionChanges = pgTable(
  'subscription_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    changeType: subscriptionChangeTypeEnum('change_type').notNull(),
    oldValue: jsonb('old_value').notNull(),
    newValue: jsonb('new_value').notNull(),
    effectiveDate: date('effective_date'),
    reason: text('reason'),
    changedById: uuid('changed_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sub_changes_sub_idx').on(t.subscriptionId, t.createdAt)],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionDelivery = typeof subscriptionDeliveries.$inferSelect;
export type SubscriptionChange = typeof subscriptionChanges.$inferSelect;
