import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { measurementUnitEnum, productCategoryEnum } from './enums.js';

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    category: productCategoryEnum('category').notNull(),
    basePrice: numeric('base_price', { precision: 10, scale: 2 }),
    unit: measurementUnitEnum('unit').notNull().default('L'),
    fatContent: numeric('fat_content', { precision: 5, scale: 2 }),
    stock: integer('stock').notNull().default(0),
    imageUrl: text('image_url'),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('products_tenant_available_idx').on(t.tenantId, t.isAvailable),
    check('products_stock_check', sql`${t.stock} >= 0`),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
    unit: measurementUnitEnum('unit').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    discountedPrice: numeric('discounted_price', { precision: 10, scale: 2 }),
    stock: integer('stock').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('product_variants_product_idx').on(t.productId),
    index('product_variants_tenant_idx').on(t.tenantId, t.isAvailable),
    uniqueIndex('product_variants_one_default').on(t.productId).where(sql`${t.isDefault} = true`),
    check('product_variants_stock_check', sql`${t.stock} >= 0`),
  ],
);

export const customerPrices = pgTable(
  'customer_prices',
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
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    effectiveFrom: date('effective_from').notNull().defaultNow(),
    effectiveUntil: date('effective_until'),
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_prices_user_idx').on(t.tenantId, t.userId),
    index('customer_prices_product_idx').on(t.tenantId, t.productId),
    check('customer_prices_price_check', sql`${t.price} >= 0`),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type CustomerPrice = typeof customerPrices.$inferSelect;
