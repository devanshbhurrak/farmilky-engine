import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { round2, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { clearCartItems, findCartByUser, findCartItems } from '../cart/cart.repository.js';
import { findProductById, findVariantById } from '../products/product.repository.js';
import {
  decrementVariantStock,
  incrementVariantStock,
  resolvePrice,
} from '../products/product.service.js';
import { transactionService } from '../transactions/transaction.service.js';
import type {
  AdminCreateOrderInput,
  AdminOrderListQuery,
  DeliveryOutcomeInput,
  InstantDeliveryInput,
  OrderItemInput,
  OrderListQuery,
  PlaceOrderInput,
  UpdateOrderInput,
} from './order.schema.js';
import {
  countOrdersAdmin,
  countOrdersByUser,
  decrementProductStockRow,
  findAreaByPincode,
  findAttemptsByOrder,
  findOrderById,
  findOrderItems,
  findPendingForDateSlot,
  incrementProductStockRow,
  insertDeliveryAttempt,
  insertOrder,
  insertOrderItems,
  listOrdersAdmin,
  listOrdersByUser,
  updateOrderRow,
  type DeliverySlot,
  type NewOrderItemRow,
  type OrderStatus,
  type UpdateOrderPatch,
} from './order.repository.js';

async function resolveAreaId(
  tenantId: string,
  pincode: string | null | undefined,
  dbOrTx: DBOrTx,
): Promise<string | null> {
  if (!pincode) return null;
  const area = await findAreaByPincode(tenantId, pincode, dbOrTx);
  return area?.id ?? null;
}

async function prepareItemsAndDecrementStock(
  tenantId: string,
  pricingUserId: string,
  items: OrderItemInput[],
  t: DBOrTx,
): Promise<{ rows: NewOrderItemRow[]; total: number }> {
  const rows: NewOrderItemRow[] = [];
  let total = 0;
  for (const item of items) {
    const product = await findProductById(tenantId, item.productId, t);
    if (!product) throw new AppError('Product not found', 404);
    let unitPrice: number;
    let variantLabel: string | null = null;
    let originalPrice: string | null = null;
    let unit: string | null = product.unit;
    if (item.variantId) {
      const variant = await findVariantById(tenantId, item.variantId, t);
      if (!variant) throw new AppError('Product variant not found', 404);
      if (variant.productId !== item.productId) {
        throw new AppError('Variant does not belong to product', 400);
      }
      if (variant.stock < item.quantity) {
        throw new AppError(`Insufficient stock for variant ${variant.label}`, 409);
      }
      const resolved = await resolvePrice(tenantId, pricingUserId, item.variantId, t);
      unitPrice = resolved.price;
      variantLabel = variant.label;
      originalPrice = String(variant.price);
      unit = variant.unit;
      try {
        await decrementVariantStock(tenantId, item.variantId, item.quantity, t);
      } catch (err) {
        if (err instanceof AppError) {
          throw new AppError(`Insufficient stock for variant ${variant.label}`, 409);
        }
        throw err;
      }
    } else {
      if (product.basePrice === null || product.basePrice === undefined) {
        throw new AppError(`Price not available for product ${product.name}`, 400);
      }
      unitPrice = Number(product.basePrice);
      if (product.stock < item.quantity) {
        throw new AppError(`Insufficient stock for product ${product.name}`, 409);
      }
      const updated = await decrementProductStockRow(tenantId, item.productId, item.quantity, t);
      if (updated.length === 0) {
        throw new AppError(`Insufficient stock for product ${product.name}`, 409);
      }
    }
    total += unitPrice * item.quantity;
    rows.push({
      productId: item.productId,
      variantId: item.variantId ?? null,
      productName: product.name,
      variantLabel,
      unit,
      quantity: String(item.quantity),
      unitPrice: unitPrice.toFixed(2),
      originalPrice,
      imageUrl: product.imageUrl ?? null,
    });
  }
  return { rows, total: round2(total) };
}

async function restoreStock(tenantId: string, orderId: string, t: DBOrTx) {
  const items = await findOrderItems(orderId, t);
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (item.variantId) {
      await incrementVariantStock(tenantId, item.variantId, qty, t);
    } else if (item.productId) {
      await incrementProductStockRow(tenantId, item.productId, qty, t);
    }
  }
}

function buildAddressPatch(address: PlaceOrderInput['address']) {
  return {
    addressStreet: address?.street ?? null,
    addressCity: address?.city ?? null,
    addressState: address?.state ?? null,
    addressPincode: address?.pincode ?? null,
    addressLat: address?.lat !== undefined ? String(address.lat) : null,
    addressLng: address?.lng !== undefined ? String(address.lng) : null,
  };
}

export async function createOrderFromCart(
  tenantId: string,
  userId: string,
  input: PlaceOrderInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const cart = await findCartByUser(tenantId, userId, t);
    const cartItems = cart ? await findCartItems(cart.id, t) : [];
    if (cartItems.length === 0) throw new AppError('Cart is empty', 400);
    const areaId = await resolveAreaId(tenantId, input.address?.pincode, t);
    const { rows, total } = await prepareItemsAndDecrementStock(
      tenantId,
      userId,
      cartItems.map((ci) => ({
        productId: ci.productId,
        variantId: ci.variantId ?? undefined,
        quantity: ci.quantity,
      })),
      t,
    );
    const today = toDateOnlyString(new Date());
    const order = await insertOrder(
      tenantId,
      {
        userId,
        areaId,
        totalAmount: total.toFixed(2),
        paymentStatus: 'pending',
        orderStatus: 'placed',
        paymentMethod: input.paymentMethod ?? 'COD',
        billingMode: input.billingMode ?? 'pay_at_delivery',
        orderDate: today,
        deliveryDate: input.deliveryDate ?? null,
        deliverySlot: input.deliverySlot ?? null,
        ...buildAddressPatch(input.address),
        createdById: userId,
      },
      t,
    );
    const items = await insertOrderItems(order.id, rows, t);
    if (cart) await clearCartItems(cart.id, t);
    return { order, items };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function createAdminOrder(
  tenantId: string,
  adminId: string,
  input: AdminCreateOrderInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const areaId = await resolveAreaId(tenantId, input.address?.pincode, t);
    const { rows, total } = await prepareItemsAndDecrementStock(tenantId, input.userId, input.items, t);
    const today = toDateOnlyString(new Date());
    const order = await insertOrder(
      tenantId,
      {
        userId: input.userId,
        areaId,
        totalAmount: total.toFixed(2),
        paymentStatus: 'pending',
        orderStatus: 'placed',
        paymentMethod: input.paymentMethod ?? 'COD',
        billingMode: input.billingMode ?? 'pay_at_delivery',
        orderDate: today,
        deliveryDate: input.deliveryDate ?? null,
        deliverySlot: input.deliverySlot ?? null,
        ...buildAddressPatch(input.address),
        createdById: adminId,
      },
      t,
    );
    const items = await insertOrderItems(order.id, rows, t);
    return { order, items };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function cancelOrder(
  tenantId: string,
  orderId: string,
  requesterId: string,
  isAdmin: boolean,
  reason?: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const order = await findOrderById(tenantId, orderId, t);
    if (!order) throw new AppError('Order not found', 404);
    if (!isAdmin && order.userId !== requesterId) throw new AppError('Forbidden', 403);
    if (order.orderStatus !== 'placed' && order.orderStatus !== 'confirmed') {
      throw new AppError('Only placed or confirmed orders can be cancelled', 409);
    }
    await restoreStock(tenantId, order.id, t);
    const updated = await updateOrderRow(
      tenantId,
      orderId,
      { orderStatus: 'cancelled', cancelledAt: new Date(), cancellationReason: reason ?? null },
      t,
    );
    if (!updated) throw new AppError('Order not found', 404);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function recordDeliveryOutcome(
  tenantId: string,
  orderId: string,
  input: DeliveryOutcomeInput & { attemptDate?: string; effectiveDate?: string },
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const order = await findOrderById(tenantId, orderId, t);
    if (!order) throw new AppError('Order not found', 404);
    if (order.orderStatus === 'cancelled') throw new AppError('Order is cancelled', 400);
    // Manifests carry their own date (possibly backdated); default to today.
    const attemptDate = input.attemptDate ?? toDateOnlyString(new Date());
    const effectiveDate = input.effectiveDate ?? attemptDate;
    if (input.status === 'delivered' && order.orderStatus === 'delivered') {
      throw new AppError('Order is already delivered', 409);
    }
    const attempt = await insertDeliveryAttempt(
      order.id,
      {
        attemptDate,
        status: input.status,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        handledById: actorId,
      },
      t,
    );
    let updated = order;
    if (input.status === 'delivered') {
      const next = await updateOrderRow(
        tenantId,
        orderId,
        { orderStatus: 'delivered', deliveredAt: new Date() },
        t,
      );
      if (!next) throw new AppError('Order not found', 404);
      updated = next;
      await transactionService.createTransaction(
        {
          tenantId,
          partyType: 'customer',
          partyId: order.userId,
          txnType: 'order',
          entryType: 'debit',
          amount: Number(order.totalAmount),
          effectiveDate,
          referenceType: 'order',
          referenceId: orderId,
          description: `Order ${orderId}`,
          createdById: actorId,
        },
        t,
      );
    }
    return { order: updated, attempt };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function createInstantDelivery(
  tenantId: string,
  adminId: string,
  input: InstantDeliveryInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const areaId = await resolveAreaId(tenantId, input.address?.pincode, t);
    const { rows, total } = await prepareItemsAndDecrementStock(tenantId, input.userId, input.items, t);
    const today = toDateOnlyString(new Date());
    const order = await insertOrder(
      tenantId,
      {
        userId: input.userId,
        areaId,
        totalAmount: total.toFixed(2),
        paymentStatus: 'pending',
        orderStatus: 'delivered',
        paymentMethod: input.paymentMethod ?? 'COD',
        billingMode: input.billingMode ?? 'pay_at_delivery',
        orderDate: today,
        deliveryDate: today,
        deliverySlot: input.deliverySlot ?? null,
        deliveredAt: new Date(),
        ...buildAddressPatch(input.address),
        createdById: adminId,
      },
      t,
    );
    const items = await insertOrderItems(order.id, rows, t);
    const attempt = await insertDeliveryAttempt(
      order.id,
      { attemptDate: today, status: 'delivered', reason: 'Instant delivery', handledById: adminId },
      t,
    );
    await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: input.userId,
        txnType: 'order',
        entryType: 'debit',
        amount: total,
        effectiveDate: today,
        referenceType: 'order',
        referenceId: order.id,
        description: `Order ${order.id}`,
        createdById: adminId,
      },
      t,
    );
    return { order, items, attempt };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function updateOrderAdmin(
  tenantId: string,
  orderId: string,
  input: UpdateOrderInput,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const order = await findOrderById(tenantId, orderId, t);
    if (!order) throw new AppError('Order not found', 404);
    const patch: UpdateOrderPatch = {};
    if (input.paymentStatus !== undefined) patch.paymentStatus = input.paymentStatus;
    if (input.paymentMethod !== undefined) patch.paymentMethod = input.paymentMethod;
    if (input.billingMode !== undefined) patch.billingMode = input.billingMode;
    if (input.deliveryDate !== undefined) patch.deliveryDate = input.deliveryDate;
    if (input.deliverySlot !== undefined) patch.deliverySlot = input.deliverySlot;
    if (input.assignedAgentId !== undefined) patch.assignedAgentId = input.assignedAgentId;
    if (input.addressStreet !== undefined) patch.addressStreet = input.addressStreet;
    if (input.addressCity !== undefined) patch.addressCity = input.addressCity;
    if (input.addressState !== undefined) patch.addressState = input.addressState;
    if (input.addressPincode !== undefined) patch.addressPincode = input.addressPincode;
    if (input.addressLat !== undefined) {
      patch.addressLat = input.addressLat === null ? null : String(input.addressLat);
    }
    if (input.addressLng !== undefined) {
      patch.addressLng = input.addressLng === null ? null : String(input.addressLng);
    }
    if (input.status !== undefined && input.status !== order.orderStatus) {
      if (input.status === 'cancelled') {
        if (order.orderStatus !== 'placed' && order.orderStatus !== 'confirmed') {
          throw new AppError('Only placed or confirmed orders can be cancelled', 409);
        }
        await restoreStock(tenantId, order.id, t);
        patch.orderStatus = 'cancelled';
        patch.cancelledAt = new Date();
      } else if (input.status === 'delivered') {
        patch.orderStatus = 'delivered';
        patch.deliveredAt = new Date();
        const attempts = await findAttemptsByOrder(order.id, t);
        const hasDelivered = attempts.some((a) => a.status === 'delivered');
        if (!hasDelivered) {
          await insertDeliveryAttempt(
            order.id,
            { attemptDate: toDateOnlyString(new Date()), status: 'delivered', handledById: actorId },
            t,
          );
          await transactionService.createTransaction(
            {
              tenantId,
              partyType: 'customer',
              partyId: order.userId,
              txnType: 'order',
              entryType: 'debit',
              amount: Number(order.totalAmount),
              effectiveDate: toDateOnlyString(new Date()),
              referenceType: 'order',
              referenceId: orderId,
              description: `Order ${orderId}`,
              createdById: actorId,
            },
            t,
          );
        }
      } else {
        patch.orderStatus = input.status;
      }
    }
    const updated = await updateOrderRow(tenantId, orderId, patch, t);
    if (!updated) throw new AppError('Order not found', 404);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function getOrderForRequester(
  tenantId: string,
  requesterId: string,
  orderId: string,
  isAdmin: boolean,
  dbOrTx: DBOrTx = db,
) {
  const order = await findOrderById(tenantId, orderId, dbOrTx);
  if (!order) throw new AppError('Order not found', 404);
  if (!isAdmin && order.userId !== requesterId) throw new AppError('Forbidden', 403);
  const items = await findOrderItems(order.id, dbOrTx);
  const attempts = await findAttemptsByOrder(order.id, dbOrTx);
  return { order, items, attempts };
}

export async function getOrderAdmin(tenantId: string, orderId: string, dbOrTx: DBOrTx = db) {
  const order = await findOrderById(tenantId, orderId, dbOrTx);
  if (!order) throw new AppError('Order not found', 404);
  const items = await findOrderItems(order.id, dbOrTx);
  const attempts = await findAttemptsByOrder(order.id, dbOrTx);
  return { order, items, attempts };
}

export async function listUserOrders(
  tenantId: string,
  userId: string,
  opts: { limit: number; offset: number; status?: OrderListQuery['status'] },
  dbOrTx: DBOrTx = db,
) {
  const status = opts.status as OrderStatus | undefined;
  const items = await listOrdersByUser(tenantId, userId, { limit: opts.limit, offset: opts.offset, status }, dbOrTx);
  const total = await countOrdersByUser(tenantId, userId, { status }, dbOrTx);
  return { items, total };
}

export async function listAdminOrders(
  tenantId: string,
  opts: { limit: number; offset: number; status?: AdminOrderListQuery['status']; search?: string },
  dbOrTx: DBOrTx = db,
) {
  const status = opts.status as OrderStatus | undefined;
  const items = await listOrdersAdmin(
    tenantId,
    { limit: opts.limit, offset: opts.offset, status, search: opts.search },
    dbOrTx,
  );
  const total = await countOrdersAdmin(tenantId, { status, search: opts.search }, dbOrTx);
  return { items, total };
}

export async function listPendingForDateSlot(
  tenantId: string,
  date: string,
  slot: DeliverySlot | undefined,
  dbOrTx: DBOrTx = db,
) {
  return findPendingForDateSlot(tenantId, date, slot, dbOrTx);
}
