import {
  boolean,
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
import { collectionSessionEnum, collectionStatusEnum } from './enums.js';

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    location: text('location'),
    pincode: text('pincode'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    joiningDate: date('joining_date'),
    morningSession: boolean('morning_session').notNull().default(true),
    eveningSession: boolean('evening_session').notNull().default(false),
    defaultMorningQty: numeric('default_morning_qty', { precision: 10, scale: 3 }).notNull().default('0'),
    expectedEveningQty: numeric('expected_evening_qty', { precision: 10, scale: 3 }).notNull().default('0'),
    defaultRatePerLiter: numeric('default_rate_per_liter', { precision: 10, scale: 2 }).notNull().default('0'),
    bankAccountNo: text('bank_account_no'),
    bankIfsc: text('bank_ifsc'),
    bankName: text('bank_name'),
    bankHolderName: text('bank_holder_name'),
    notes: text('notes'),
    linkedUserId: uuid('linked_user_id').references(() => users.id),
    balance: numeric('balance', { precision: 12, scale: 2 }).notNull().default('0'),
    updatedById: uuid('updated_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('suppliers_tenant_active_idx').on(t.tenantId, t.isActive),
    // Bounded like users.account_balance — supplier balances may legitimately
    // go either way but never to an absurd value.
    check('suppliers_balance_bounded', sql`${t.balance} >= -999999.99 AND ${t.balance} <= 9999999.99`),
  ],
);

export const milkCollections = pgTable(
  'milk_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    collectionDate: date('collection_date').notNull(),
    session: collectionSessionEnum('session').notNull(),
    expectedQty: numeric('expected_qty', { precision: 10, scale: 3 }).notNull().default('0'),
    actualQty: numeric('actual_qty', { precision: 10, scale: 3 }),
    fatContent: numeric('fat_content', { precision: 5, scale: 2 }),
    snf: numeric('snf', { precision: 5, scale: 2 }),
    ratePerLiter: numeric('rate_per_liter', { precision: 10, scale: 2 }).notNull().default('0'),
    status: collectionStatusEnum('status').notNull().default('pending'),
    confirmedById: uuid('confirmed_by_id').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('milk_coll_date_status_idx').on(t.tenantId, t.collectionDate, t.status),
    index('milk_coll_supplier_idx').on(t.supplierId, t.collectionDate),
    index('milk_coll_supplier_status_idx').on(t.tenantId, t.supplierId, t.status),
    check('milk_coll_qty_check', sql`${t.actualQty} IS NULL OR ${t.actualQty} >= 0`),
  ],
);

export type Supplier = typeof suppliers.$inferSelect;
export type MilkCollection = typeof milkCollections.$inferSelect;
