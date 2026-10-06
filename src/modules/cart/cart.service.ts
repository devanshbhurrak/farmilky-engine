import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import type { Cart } from '../../shared/db/schema/index.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { round2 } from '../../shared/utils/dateUtils.js';
import { findProductById, findVariantById } from '../products/product.repository.js';
import { resolvePrice } from '../products/product.service.js';
import type { AddItemInput, UpdateItemInput } from './cart.schema.js';
import {
  clearCartItems,
  createCartRow,
  deleteCartItemByProduct,
  findCartByUser,
  findCartItemByProduct,
  findCartItems,
  insertCartItem,
  touchCart,
  updateCartItemQty,
} from './cart.repository.js';

export async function getOrCreateCart(tenantId: string, userId: string, dbOrTx: DBOrTx = db) {
  const existing = await findCartByUser(tenantId, userId, dbOrTx);
  if (existing) return existing;
  return createCartRow(tenantId, userId, dbOrTx);
}

export interface EnrichedCartItem {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  productName: string;
  productImage: string | null;
  variantLabel: string | null;
  unitPrice: number;
  originalPrice: number | null;
  stock: number | null;
  lineTotal: number;
}

export interface CartView {
  cart: Cart;
  items: EnrichedCartItem[];
  cartTotal: number;
}

export async function getCart(
  tenantId: string,
  userId: string,
  dbOrTx: DBOrTx = db,
): Promise<CartView> {
  const cart = await getOrCreateCart(tenantId, userId, dbOrTx);
  const items = await findCartItems(cart.id, dbOrTx);
  const enriched: EnrichedCartItem[] = [];
  for (const item of items) {
    const product = await findProductById(tenantId, item.productId, dbOrTx);
    if (!product) continue;
    let unitPrice: number;
    let variantLabel: string | null = null;
    let originalPrice: number | null = null;
    let stock: number | null = product.stock;
    if (item.variantId) {
      const variant = await findVariantById(tenantId, item.variantId, dbOrTx);
      if (!variant) continue;
      const resolved = await resolvePrice(tenantId, userId, item.variantId, dbOrTx);
      unitPrice = resolved.price;
      variantLabel = variant.label;
      originalPrice = Number(variant.price);
      stock = variant.stock;
    } else {
      if (product.basePrice === null || product.basePrice === undefined) continue;
      unitPrice = Number(product.basePrice);
    }
    enriched.push({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      productName: product.name,
      productImage: product.imageUrl,
      variantLabel,
      unitPrice,
      originalPrice,
      stock,
      lineTotal: round2(unitPrice * item.quantity),
    });
  }
  return { cart, items: enriched, cartTotal: round2(enriched.reduce((sum, i) => sum + i.lineTotal, 0)) };
}

async function assertProductAndVariant(
  tenantId: string,
  productId: string,
  variantId: string | null | undefined,
  dbOrTx: DBOrTx,
) {
  const product = await findProductById(tenantId, productId, dbOrTx);
  if (!product) throw new AppError('Product not found', 404);
  if (variantId) {
    const variant = await findVariantById(tenantId, variantId, dbOrTx);
    if (!variant) throw new AppError('Product variant not found', 404);
    if (variant.productId !== productId) throw new AppError('Variant does not belong to product', 400);
  }
  return product;
}

export async function addItem(
  tenantId: string,
  userId: string,
  input: AddItemInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    await assertProductAndVariant(tenantId, input.productId, input.variantId, t);
    const cart = await getOrCreateCart(tenantId, userId, t);
    const existing = await findCartItemByProduct(cart.id, input.productId, input.variantId ?? null, t);
    if (existing) {
      const nextQty = existing.quantity + input.quantity;
      if (nextQty > 100) throw new AppError('Cart quantity cannot exceed 100 per item', 400);
      await updateCartItemQty(existing.id, nextQty, t);
    } else {
      await insertCartItem(
        cart.id,
        { productId: input.productId, variantId: input.variantId ?? null, quantity: input.quantity },
        t,
      );
    }
    await touchCart(cart.id, t);
    return getCart(tenantId, userId, t);
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function updateItem(
  tenantId: string,
  userId: string,
  input: UpdateItemInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    await assertProductAndVariant(tenantId, input.productId, input.variantId, t);
    const cart = await getOrCreateCart(tenantId, userId, t);
    const existing = await findCartItemByProduct(cart.id, input.productId, input.variantId ?? null, t);
    if (!existing) throw new AppError('Cart item not found', 404);
    await updateCartItemQty(existing.id, input.quantity, t);
    await touchCart(cart.id, t);
    return getCart(tenantId, userId, t);
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function removeItem(
  tenantId: string,
  userId: string,
  productId: string,
  variantId?: string | null,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const cart = await getOrCreateCart(tenantId, userId, t);
    const deleted = await deleteCartItemByProduct(cart.id, productId, variantId ?? null, t);
    if (!deleted) throw new AppError('Cart item not found', 404);
    await touchCart(cart.id, t);
    return getCart(tenantId, userId, t);
  };
  if (tx) {
    const result = await run(tx);
    return result;
  }
  return withTransaction((t) => run(t));
}

export async function clearCart(tenantId: string, userId: string, tx?: DrizzleTx) {
  const run = async (t: DBOrTx) => {
    const cart = await getOrCreateCart(tenantId, userId, t);
    await clearCartItems(cart.id, t);
    await touchCart(cart.id, t);
    return getCart(tenantId, userId, t);
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}
