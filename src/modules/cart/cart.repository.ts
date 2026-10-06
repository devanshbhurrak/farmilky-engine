import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { cartItems, carts } from '../../shared/db/schema/index.js';

export async function findCartByUser(tenantId: string, userId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(carts)
    .where(and(eq(carts.tenantId, tenantId), eq(carts.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function createCartRow(tenantId: string, userId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db).insert(carts).values({ tenantId, userId }).returning();
  return rows[0]!;
}

export async function touchCart(cartId: string, dbOrTx: DBOrTx = db) {
  await (dbOrTx as typeof db)
    .update(carts)
    .set({ updatedAt: new Date() })
    .where(eq(carts.id, cartId));
}

export async function findCartItems(cartId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .orderBy(cartItems.addedAt);
}

export async function findCartItemByProduct(
  cartId: string,
  productId: string,
  variantId: string | null | undefined,
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)];
  conditions.push(variantId ? eq(cartItems.variantId, variantId) : isNull(cartItems.variantId));
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(cartItems)
    .where(and(...conditions))
    .limit(1);
  return rows[0];
}

export async function insertCartItem(
  cartId: string,
  data: { productId: string; variantId?: string | null; quantity: number },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(cartItems)
    .values({
      cartId,
      productId: data.productId,
      variantId: data.variantId ?? null,
      quantity: data.quantity,
    })
    .returning();
  return rows[0]!;
}

export async function updateCartItemQty(itemId: string, quantity: number, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .update(cartItems)
    .set({ quantity })
    .where(eq(cartItems.id, itemId))
    .returning();
  return rows[0];
}

export async function deleteCartItemByProduct(
  cartId: string,
  productId: string,
  variantId: string | null | undefined,
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)];
  conditions.push(variantId ? eq(cartItems.variantId, variantId) : isNull(cartItems.variantId));
  const rows = await (dbOrTx as typeof db)
    .delete(cartItems)
    .where(and(...conditions))
    .returning({ id: cartItems.id });
  return rows[0];
}

export async function clearCartItems(cartId: string, dbOrTx: DBOrTx = db) {
  await (dbOrTx as typeof db).delete(cartItems).where(eq(cartItems.cartId, cartId));
}
