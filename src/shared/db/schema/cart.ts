import { check, index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { products, productVariants } from './products.js';

export const carts = pgTable('carts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    quantity: integer('quantity').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cart_items_cart_idx').on(t.cartId),
    // Duplicate detection mirrors findCartItemByProduct (cart + product +
    // variant). Variant is part of the key so two variants of the same
    // product can coexist as separate lines. The partial index covers the
    // NULL-variant case (plain unique indexes treat NULLs as distinct).
    uniqueIndex('cart_items_cart_product_unique').on(t.cartId, t.productId, t.variantId),
    uniqueIndex('cart_items_cart_product_novariant_unique')
      .on(t.cartId, t.productId)
      .where(sql`${t.variantId} IS NULL`),
    check('cart_items_qty_check', sql`${t.quantity} > 0`),
  ],
);

export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
