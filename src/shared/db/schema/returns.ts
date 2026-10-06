import { check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { orders, orderItems } from './orders.js';
import { returnStatusEnum } from './enums.js';

export const returns = pgTable(
  'returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    status: returnStatusEnum('status').notNull().default('requested'),
    adminNotes: text('admin_notes'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: uuid('resolved_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('returns_status_idx').on(t.tenantId, t.status),
    index('returns_user_idx').on(t.tenantId, t.userId),
  ],
);

export const returnItems = pgTable(
  'return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    productName: text('product_name').notNull(),
    variantLabel: text('variant_label'),
  },
  (t) => [
    index('return_items_return_idx').on(t.returnId),
    check('return_items_qty_check', sql`${t.quantity} > 0`),
  ],
);

export type Return = typeof returns.$inferSelect;
export type ReturnItem = typeof returnItems.$inferSelect;
