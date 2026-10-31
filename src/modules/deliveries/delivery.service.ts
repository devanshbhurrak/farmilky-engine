import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { and, eq, sql } from 'drizzle-orm';
import { round2, toDateOnlyString, addDays } from '../../shared/utils/dateUtils.js';
import { istToday } from '../../shared/utils/dateUtils.js';
import {
  advanceToNextDue,
  isSubscriptionDueOnDate,
} from '../subscriptions/subscription.schedule.js';
import { getHolidayDateSet } from '../holidays/holiday.service.js';
import {
  decrementVariantStock,
  incrementVariantStock,
  resolvePrice,
} from '../products/product.service.js';
import { findProductById, findVariantById } from '../products/product.repository.js';
import { transactionService } from '../transactions/transaction.service.js';
import { findActiveTransactionByRef } from '../transactions/transaction.repository.js';
import {
  insertDelivery,
  insertDeliveryItems,
  findDeliveryById,
  findDeliveryByIdempotencyKey,
  findDeliveryByReference,
  updateDeliveryOptimistic,
  findDeliveryWithItems,
  linkOrderAttempt,
  findActiveChargeTransactionsForDelivery,
  findActiveCreditTransactionsForDelivery,
  markMissedDeliveries as markMissedDeliveriesRepo,
  aggregateCustomerDeliveries,
  type DeliveryStatus,
  type DeliveryType,
  type DeliveryPaymentMode,
  type DeliveryPaymentStatus,
  type NewDeliveryItem,
} from './delivery.repository.js';
import {
  findOrderById,
  updateOrderRow,
  findOrderItems,
  decrementProductStockRow,
  incrementProductStockRow,
} from '../orders/order.repository.js';
import {
  findSubscriptionById,
  updateSubscriptionRow,
  listSubscriptionSlots,
  type SubscriptionRow,
} from '../subscriptions/subscription.repository.js';
import { deliveries, transactions, users } from '../../shared/db/schema/index.js';

type Subscription = SubscriptionRow;

const CHARGEABLE: Record<DeliveryStatus, boolean> = {
  delivered: true,
  partial: true,
  extra: true,
  failed: false,
  skipped: false,
  missed: false,
  pending: false,
};

const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));
const money = (v: number): string => round2(v).toFixed(2);

interface SlotConfig {
  slot: 'morning' | 'evening';
  qty: number;
}

async function loadSlotConfig(tenantId: string, sub: SubscriptionRow, dbOrTx: DBOrTx): Promise<SlotConfig[]> {
  const rows = await listSubscriptionSlots(tenantId, sub.id, dbOrTx);
  if (rows.length > 0) {
    return rows.map((r) => ({ slot: r.deliverySlot as SlotConfig['slot'], qty: num(r.quantityPerDelivery) }));
  }
  return [{ slot: sub.deliverySlot as SlotConfig['slot'], qty: num(sub.quantityPerDelivery) }];
}

function chargeableQty(status: DeliveryStatus, scheduledQty: number, actualQty?: number): number {
  if (!CHARGEABLE[status]) return 0;
  if (status === 'delivered') return scheduledQty;
  if (status === 'partial' || status === 'extra') {
    const qty = actualQty ?? 0;
    if (!(qty > 0)) throw new AppError(`actualQuantity must be positive for ${status} outcomes`, 422);
    return qty;
  }
  return 0;
}

async function findDefaultVariant(
  tenantId: string,
  productId: string,
  dbOrTx: DBOrTx,
): Promise<{ id: string; label: string; unit: string | null } | null> {
  const { productVariants } = await import('../../shared/db/schema/index.js');
  const { and, eq } = await import('drizzle-orm');
  const all = await dbOrTx
    .select()
    .from(productVariants)
    .where(
      and(
        eq(productVariants.tenantId, tenantId),
        eq(productVariants.productId, productId),
        eq(productVariants.isAvailable, true),
      ),
    );
  const def = all.find((v) => v.isDefault);
  if (def) return { id: def.id, label: def.label, unit: def.unit };
  if (all[0]) return { id: all[0].id, label: all[0].label, unit: all[0].unit };
  return null;
}

/** Resolve unit price honoring customer-specific pricing; falls back to product base price. */
async function resolveUnitPrice(
  tenantId: string,
  customerId: string | null,
  productId: string,
  variantId: string | null | undefined,
  dbOrTx: DBOrTx,
): Promise<{ price: number; productName: string; unit: string | null; variantLabel: string | null }> {
  const product = await findProductById(tenantId, productId, dbOrTx);
  if (!product) throw new AppError('Product not found', 404);
  let variantIdResolved = variantId;
  let variantLabel: string | null = null;
  let unit: string | null = product.unit;

  if (variantIdResolved) {
    const variant = await findVariantById(tenantId, variantIdResolved, dbOrTx);
    if (!variant || variant.productId !== productId) {
      throw new AppError('Product variant not found', 404);
    }
    variantLabel = variant.label;
    unit = variant.unit;
  } else {
    const defaultVariant = await findDefaultVariant(tenantId, productId, dbOrTx);
    if (defaultVariant) {
      variantIdResolved = defaultVariant.id;
      variantLabel = defaultVariant.label;
      unit = defaultVariant.unit;
    }
  }

  let price: number;
  if (variantIdResolved) {
    const resolved = await resolvePrice(tenantId, customerId ?? null, variantIdResolved, dbOrTx);
    price = resolved.price;
  } else if (product.basePrice != null) {
    price = Number(product.basePrice);
  } else {
    throw new AppError('Price not available for product', 404);
  }
  return { price, productName: product.name, unit, variantLabel };
}

interface DeliveryOutcomeResult {
  delivery: NonNullable<Awaited<ReturnType<typeof findDeliveryWithItems>>>['delivery'];
  items: NonNullable<Awaited<ReturnType<typeof findDeliveryWithItems>>>['items'];
  transactionId: string | null;
  ledgerChanged: boolean;
}

/**
 * Record (or re-record/correct) a delivery outcome for a specific customer.
 *
 * Canonical transactional entry point for daily subscriptions, one-time orders
 * and instant/rush deliveries. Idempotent via `idempotencyKey`, optimistic
 * locked via `expectedVersion`, and keeps the delivery record, stock, ledger
 * and schedule consistent.
 */
export async function recordDeliveryOutcome(
  tenantId: string,
  input: {
    customerId: string;
    type: DeliveryType;
    referenceType?: 'subscription' | 'order' | null;
    referenceId?: string | null;
    deliveryDate: string;
    deliverySlot?: (typeof deliveries.deliverySlot.enumValues)[number] | null;
    status: DeliveryStatus;
    scheduledQuantity?: number;
    actualQuantity?: number;
    pricePerPacket?: number;
    items?: Array<{
      productId: string;
      variantId?: string | null;
      productName: string;
      variantLabel?: string | null;
      unit?: string | null;
      quantity: number;
      unitPrice: number;
    }>;
    paymentMode?: (typeof deliveries.paymentMode.enumValues)[number] | null;
    reason?: string | null;
    notes?: string | null;
    idempotencyKey?: string | null;
    expectedVersion?: number | null;
  },
  actorId: string,
  tx?: DrizzleTx,
): Promise<DeliveryOutcomeResult> {
  const run = async (t: DrizzleTx): Promise<DeliveryOutcomeResult> => {
    // ---- customer ----
    const customerRows = await t
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, input.customerId), eq(users.tenantId, tenantId)))
      .limit(1);
    const customer = customerRows[0];
    if (!customer) throw new AppError('Customer not found', 404);
    if (customer.role !== 'customer') throw new AppError('Party is not a customer', 400);
    if (!customer.isActive) throw new AppError('Customer is inactive', 403);

    const chargeable = CHARGEABLE[input.status];
    const scheduledQty = num(input.scheduledQuantity ?? 0);

    // ---- idempotency ----
    if (input.idempotencyKey) {
      const existing = await findDeliveryByIdempotencyKey(tenantId, input.idempotencyKey, t);
      if (existing) {
        const found = await findDeliveryWithItems(tenantId, existing.id, t);
        return { delivery: found!.delivery, items: found!.items, transactionId: null, ledgerChanged: false };
      }
    }

    // ---- resolve subscription / order context ----
    let sub: SubscriptionRow | null = null;
    let slotConfig: SlotConfig[] = [];
    let orderId: string | null = null;

    if (input.type === 'subscription') {
      if (!input.referenceId) throw new AppError('referenceId is required for subscription deliveries', 422);
      sub = await findSubscriptionById(tenantId, input.referenceId, t);
      if (!sub) throw new AppError('Subscription not found', 404);
      if (sub.userId !== input.customerId) throw new AppError('Subscription does not belong to this customer', 403);
      slotConfig = await loadSlotConfig(tenantId, sub, t);
      const slot = input.deliverySlot ?? (slotConfig.length === 1 ? slotConfig[0].slot : null);
      const resolvedQty = scheduledQtyFor('subscription', sub, slotConfig, slot);
      if (input.scheduledQuantity == null) input.scheduledQuantity = resolvedQty;
      if (chargeable && sub.status !== 'active') {
        throw new AppError('Only active subscriptions can be billed for a delivery', 409);
      }
      if (sub.status === 'active') {
        const holidays = await getHolidayDateSet(tenantId, t);
        const today = toDateOnlyString(istToday());
        const due = isSubscriptionDueOnDate(sub, input.deliveryDate, holidays);
        if (input.deliveryDate > today && !due) {
          throw new AppError('Subscription is not due for delivery on this date', 409);
        }
      }
    } else if (input.type === 'order') {
      if (!input.referenceId) throw new AppError('referenceId is required for order deliveries', 422);
      const order = await findOrderById(tenantId, input.referenceId, t);
      if (!order) throw new AppError('Order not found', 404);
      if (order.userId !== input.customerId) throw new AppError('Order does not belong to this customer', 403);
      orderId = order.id;
      if (chargeable && order.orderStatus === 'delivered') throw new AppError('Order is already delivered', 409);
      if (order.orderStatus === 'cancelled') throw new AppError('Order is cancelled', 409);
    }

    // ---- existing delivery for same customer + reference + date + slot ----
    const slotForLookup = input.type === 'subscription' ? input.deliverySlot : null;
    const existing = input.referenceId
      ? await findDeliveryByReference(
          tenantId,
          input.type,
          input.referenceId,
          input.deliveryDate,
          slotForLookup ?? undefined,
          t,
        )
      : null;

    // ---- items & price ----
    let rows: Array<{
      productId: string;
      variantId: string | null;
      productName: string;
      variantLabel: string | null;
      unit: string | null;
      quantity: number;
      unitPrice: number;
      amount: number;
    }> = [];
    let resolvedPrice = num(input.pricePerPacket ?? 0);

    if (input.items && input.items.length > 0) {
      for (const it of input.items) {
        const resolved = await resolveUnitPrice(tenantId, input.customerId, it.productId, it.variantId ?? null, t);
        const unitPrice = it.unitPrice > 0 ? it.unitPrice : resolved.price;
        const qty = num(it.quantity);
        rows.push({
          productId: it.productId,
          variantId: it.variantId ?? null,
          productName: it.productName ?? resolved.productName,
          variantLabel: it.variantLabel ?? resolved.variantLabel ?? null,
          unit: it.unit ?? resolved.unit ?? null,
          quantity: qty,
          unitPrice,
          amount: round2(unitPrice * qty),
        });
        if (resolvedPrice === 0) resolvedPrice = unitPrice;
      }
    } else if (input.type === 'subscription' && sub) {
      const variantId = sub.variantId ?? undefined;
      const resolved = await resolveUnitPrice(tenantId, input.customerId, sub.productId, variantId, t);
      // Prioritize customPrice/pricePerPacket locked at subscription creation over current catalog price
      const subPrice = sub.pricePerPacket != null && Number(sub.pricePerPacket) > 0
        ? Number(sub.pricePerPacket)
        : resolved.price;
      if (resolvedPrice === 0) resolvedPrice = subPrice;
      const qty = num(input.scheduledQuantity ?? scheduledQty);
      rows.push({
        productId: sub.productId,
        variantId: variantId ?? null,
        productName: resolved.productName,
        variantLabel: resolved.variantLabel ?? null,
        unit: resolved.unit ?? null,
        quantity: qty,
        unitPrice: subPrice,
        amount: round2(subPrice * qty),
      });
    } else if (input.type === 'order' && orderId) {
      const items = await findOrderItems(orderId, t);
      for (const it of items) {
        const resolved = await resolveUnitPrice(tenantId, input.customerId, it.productId ?? '', it.variantId ?? null, t);
        const qty = num(it.quantity);
        // Prioritize unitPrice agreed at order creation over current catalog price
        const itemPrice = it.unitPrice != null && Number(it.unitPrice) > 0
          ? Number(it.unitPrice)
          : resolved.price;
        rows.push({
          productId: it.productId ?? '',
          variantId: it.variantId ?? null,
          productName: it.productName,
          variantLabel: it.variantLabel ?? null,
          unit: it.unit ?? resolved.unit ?? null,
          quantity: qty,
          unitPrice: itemPrice,
          amount: round2(itemPrice * qty),
        });
        if (resolvedPrice === 0) resolvedPrice = itemPrice;
      }
    }

    if (input.pricePerPacket == null) input.pricePerPacket = resolvedPrice;
    const finalQty = chargeableQty(input.status, num(input.scheduledQuantity ?? scheduledQty), input.actualQuantity);
    // For multi-item deliveries (or single item), sum the amounts accurately
    const calculatedRowsTotal = rows.reduce((acc, r) => acc + r.amount, 0);
    const finalAmount = rows.length > 1
      ? round2(calculatedRowsTotal)
      : round2(finalQty * resolvedPrice);
    if (input.scheduledQuantity == null) input.scheduledQuantity = finalQty || scheduledQty;

    // ---- re-record: reverse old ledger + stock ----
    let previousTxnId: string | null = null;
    let ledgerChanged = false;
    if (existing && chargeable && CHARGEABLE[existing.status as DeliveryStatus]) {
      const linked = await findActiveTransactionByRef(tenantId, 'delivery', existing.id, t);
      if (linked) {
        await transactionService.voidTransaction(linked.id, tenantId, 'Delivery outcome re-recorded', actorId, t);
        previousTxnId = linked.id;
        ledgerChanged = true;
      }
      await restoreStock(tenantId, sub?.variantId ?? null, sub?.productId ?? null, num(existing.actualQuantity ?? 0), t);
    }

    // ---- insert / update delivery record ----
    let delivery: any;
    if (existing) {
      const updated = await updateDeliveryOptimistic(
        tenantId,
        existing.id,
        {
          status: input.status,
          scheduledQuantity: money(num(input.scheduledQuantity ?? 0)),
          actualQuantity: finalQty > 0 ? money(finalQty) : '0',
          pricePerPacket: money(resolvedPrice),
          totalAmount: money(finalAmount),
          paymentMode: input.paymentMode ?? null,
          paymentStatus: chargeable ? (existing.paymentStatus as any) : 'pending',
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          handledById: actorId,
          attemptedAt: new Date(`${input.deliveryDate}T00:00:00`),
          deliveredAt: chargeable ? new Date() : null,
        },
        num(existing.version),
        t,
      );
      if (!updated) throw new AppError('Delivery record was concurrently modified', 409);
      delivery = updated;
    } else {
      const created = await insertDelivery(
        {
          tenantId,
          customerId: input.customerId,
          type: input.type,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          deliveryDate: input.deliveryDate,
          deliverySlot: input.deliverySlot ?? null,
          status: input.status,
          scheduledQuantity: money(num(input.scheduledQuantity ?? 0)),
          actualQuantity: finalQty > 0 ? money(finalQty) : '0',
          pricePerPacket: money(resolvedPrice),
          totalAmount: money(finalAmount),
          paymentMode: input.paymentMode ?? null,
          paymentStatus: chargeable ? 'pending' : 'pending',
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          handledById: actorId,
          idempotencyKey: input.idempotencyKey ?? null,
          attemptedAt: new Date(`${input.deliveryDate}T00:00:00`),
          deliveredAt: chargeable ? new Date() : null,
        },
        t,
      );
      delivery = created;
    }

    const deliveryItemsRows = rows.map((r) => ({
      productId: r.productId,
      variantId: r.variantId,
      productName: r.productName,
      variantLabel: r.variantLabel,
      unit: r.unit,
      quantity: String(r.quantity),
      unitPrice: money(r.unitPrice),
      amount: money(r.amount),
    }));
    if (deliveryItemsRows.length > 0) await insertDeliveryItems(delivery.id, deliveryItemsRows, t);

    // ---- financial: debit customer ----
    let transactionId: string | null = null;
    if (chargeable && finalAmount > 0) {
      const txn = await transactionService.createTransaction(
        {
          tenantId,
          partyType: 'customer',
          partyId: input.customerId,
          txnType: 'delivery',
          entryType: 'debit',
          amount: finalAmount,
          effectiveDate: input.deliveryDate,
          referenceType: 'delivery',
          referenceId: delivery.id,
          paymentMethod: null,
          description: `${input.type} delivery ${input.deliveryDate}`,
          notes: input.notes ?? null,
          createdById: actorId,
          items: deliveryItemsRows.map((r, i) => ({
            description: r.productName,
            productId: r.productId ?? undefined,
            productName: r.productName,
            variantLabel: r.variantLabel ?? undefined,
            quantity: num(r.quantity),
            unit: r.unit ?? undefined,
            rate: num(r.unitPrice),
            amount: num(r.amount),
            referenceType: 'delivery',
            referenceId: delivery.id,
            sortOrder: i,
          })),
        },
        t,
      );
      transactionId = txn.id;
      if (previousTxnId) {
        await t
          .update(transactions)
          .set({ correctsTxnId: txn.id, updatedAt: new Date() })
          .where(and(eq(transactions.id, previousTxnId), eq(transactions.tenantId, tenantId)));
      }
      ledgerChanged = true;

      // ---- stock ----
      await decrementStock(tenantId, sub?.variantId ?? null, sub?.productId ?? null, finalQty, t);

      // ---- order completion ----
      if (input.type === 'order' && orderId) {
        const order = await findOrderById(tenantId, orderId, t);
        if (order && order.orderStatus !== 'delivered') {
          await updateOrderRow(tenantId, orderId, { orderStatus: 'delivered', deliveredAt: new Date() }, t);
          await linkOrderAttempt(orderId, input.deliveryDate, 'delivered', input.reason ?? null, actorId, t);
        }
      }

      // ---- subscription schedule advancement ----
      if (input.type === 'subscription' && sub && input.deliveryDate) {
        const today = toDateOnlyString(istToday());
        if (input.deliveryDate >= today) {
          const holidays = await getHolidayDateSet(tenantId, t);
          const next = toDateOnlyString(advanceToNextDue(sub, addDays(input.deliveryDate, 1), holidays));
          await updateSubscriptionRow(tenantId, sub.id, { nextDeliveryDate: next }, t);
        }
      }
    }

    const found = await findDeliveryWithItems(tenantId, delivery.id, t);
    return { delivery: found!.delivery, items: found!.items, transactionId, ledgerChanged };
  };

  return tx ? await run(tx) : await withTransaction(run);
}

/** Correct a previously recorded delivery with a full audit trail. */
export async function correctDelivery(
  tenantId: string,
  deliveryId: string,
  input: {
    status?: DeliveryStatus;
    actualQuantity?: number;
    scheduledQuantity?: number;
    pricePerPacket?: number;
    reason?: string | null;
    notes?: string | null;
  },
  actorId: string,
  expectedVersion: number,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findDeliveryById(tenantId, deliveryId, t);
    if (!existing) throw new AppError('Delivery not found', 404);
    if (num(existing.version) !== expectedVersion) {
      throw new AppError('Delivery record version mismatch — concurrent modification', 409);
    }

    const oldChargeable = CHARGEABLE[existing.status as DeliveryStatus];
    if (oldChargeable) {
      const linked = await findActiveTransactionByRef(tenantId, 'delivery', deliveryId, t);
      if (linked) {
        await transactionService.voidTransaction(linked.id, tenantId, 'Delivery corrected', actorId, t);
        await restoreStock(tenantId, null, null, num(existing.actualQuantity ?? 0), t);
      }
    }

    const newStatus = input.status ?? (existing.status as DeliveryStatus);
    const price = input.pricePerPacket ?? num(existing.pricePerPacket);
    const qty = chargeableQty(newStatus, num(input.scheduledQuantity ?? num(existing.scheduledQuantity)), input.actualQuantity);
    const amount = round2(qty * price);

    const updated = await updateDeliveryOptimistic(
      tenantId,
      deliveryId,
      {
        status: newStatus,
        scheduledQuantity: money(num(input.scheduledQuantity ?? num(existing.scheduledQuantity))),
        actualQuantity: qty > 0 ? money(qty) : '0',
        pricePerPacket: money(price),
        totalAmount: money(amount),
        reason: input.reason ?? existing.reason ?? null,
        notes: input.notes ?? existing.notes ?? null,
        handledById: actorId,
        deliveredAt: CHARGEABLE[newStatus] ? new Date() : null,
      },
      expectedVersion,
      t,
    );
    if (!updated) throw new AppError('Delivery not found', 404);

    let transactionId: string | null = null;
    if (CHARGEABLE[newStatus] && amount > 0) {
      const txn = await transactionService.createTransaction(
        {
          tenantId,
          partyType: 'customer',
          partyId: existing.customerId,
          txnType: 'delivery',
          entryType: 'debit',
          amount,
          effectiveDate: existing.deliveryDate,
          referenceType: 'delivery',
          referenceId: deliveryId,
          description: `Corrected delivery ${existing.deliveryDate}`,
          notes: input.notes ?? null,
          createdById: actorId,
        },
        t,
      );
      transactionId = txn.id;
      await decrementStock(tenantId, null, null, qty, t);
    }

    const found = await findDeliveryWithItems(tenantId, deliveryId, t);
    return { delivery: found!.delivery, items: found!.items, transactionId };
  };
  return tx ? await run(tx) : await withTransaction(run);
}

/** Reschedule a delivery to a new date/slot (original kept as history). */
export async function rescheduleDelivery(
  tenantId: string,
  deliveryId: string,
  input: {
    newDeliveryDate: string;
    newDeliverySlot?: (typeof deliveries.deliverySlot.enumValues)[number] | null;
    reason: string;
    idempotencyKey?: string | null;
  },
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findDeliveryById(tenantId, deliveryId, t);
    if (!existing) throw new AppError('Delivery not found', 404);
    if (CHARGEABLE[existing.status as DeliveryStatus]) {
      throw new AppError('Cannot reschedule an already delivered/chargeable delivery', 409);
    }
    if (input.idempotencyKey) {
      const dup = await findDeliveryByIdempotencyKey(tenantId, input.idempotencyKey, t);
      if (dup) {
        const f = await findDeliveryWithItems(tenantId, dup.id, t);
        return { delivery: f!.delivery, items: f!.items, rescheduled: false };
      }
    }
    const created = await insertDelivery(
      {
        tenantId,
        customerId: existing.customerId,
        type: existing.type,
        referenceType: existing.referenceType ?? undefined,
        referenceId: existing.referenceId ?? undefined,
        deliveryDate: input.newDeliveryDate,
        deliverySlot: input.newDeliverySlot ?? null,
        status: 'pending',
        scheduledQuantity: existing.scheduledQuantity,
        actualQuantity: null,
        pricePerPacket: existing.pricePerPacket,
        totalAmount: '0',
        paymentMode: existing.paymentMode ?? null,
        paymentStatus: 'pending',
        reason: input.reason,
        notes: `Rescheduled from ${existing.deliveryDate} ${existing.deliverySlot ?? ''}. ${input.reason}`,
        handledById: actorId,
        rescheduledFromId: existing.id,
        rescheduleReason: input.reason,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      t,
    );
    const createdFound = await findDeliveryWithItems(tenantId, created.id, t);
    return { delivery: createdFound!.delivery, items: createdFound!.items, rescheduled: true };
  };
  return tx ? await run(tx) : await withTransaction(run);
}

/** Cancel a delivery (reverse charges, restore stock). */
export async function cancelDelivery(
  tenantId: string,
  deliveryId: string,
  input: { reason: string; restock?: boolean },
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const existing = await findDeliveryById(tenantId, deliveryId, t);
    if (!existing) throw new AppError('Delivery not found', 404);
    const chargeable = CHARGEABLE[existing.status as DeliveryStatus];
    if (chargeable) {
      const linked = await findActiveTransactionByRef(tenantId, 'delivery', deliveryId, t);
      if (linked) {
        await transactionService.voidTransaction(linked.id, tenantId, 'Delivery cancelled', actorId, t);
        if (input.restock !== false) {
          await restoreStock(tenantId, null, null, num(existing.actualQuantity ?? 0), t);
        }
      }
    }
    const updated = await updateDeliveryOptimistic(
      tenantId,
      deliveryId,
      {
        status: 'skipped',
        actualQuantity: '0',
        totalAmount: '0',
        paymentStatus: 'failed',
        reason: input.reason,
        notes: (existing.notes ? `${existing.notes}; ` : '') + `Cancelled: ${input.reason}`,
        handledById: actorId,
        deliveredAt: null,
      },
      num(existing.version),
      t,
    );
    if (!updated) throw new AppError('Delivery was concurrently modified', 409);
    const cancelledFound = await findDeliveryWithItems(tenantId, deliveryId, t);
    return { delivery: cancelledFound!.delivery, items: cancelledFound!.items, reversed: chargeable };
  };
  return tx ? await run(tx) : await withTransaction(run);
}

/** Record a payment against a delivery and allocate it to the outstanding charge. */
export async function recordPaymentAgainstDelivery(
  tenantId: string,
  deliveryId: string,
  input: {
    amount: number;
    paymentMethod: string;
    paymentRef?: string | null;
    receivedDate?: string | null;
    description?: string | null;
    notes?: string | null;
  },
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const delivery = await findDeliveryById(tenantId, deliveryId, t);
    if (!delivery) throw new AppError('Delivery not found', 404);
    const amount = round2(num(input.amount));
    if (!(amount > 0)) throw new AppError('Payment amount must be positive', 400);

    const effectiveDate = input.receivedDate ?? toDateOnlyString(istToday());

    const txn = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: delivery.customerId,
        txnType: 'payment',
        entryType: 'credit',
        amount,
        effectiveDate,
        referenceType: 'delivery',
        referenceId: deliveryId,
        paymentMethod: input.paymentMethod as any,
        paymentRef: input.paymentRef ?? null,
        receivedDate: effectiveDate,
        description: input.description ?? `Payment for delivery ${delivery.deliveryDate}`,
        notes: input.notes ?? null,
        createdById: actorId,
      },
      t,
    );

    const charges = await findActiveChargeTransactionsForDelivery(tenantId, 'delivery', deliveryId, t);
    const credits = await findActiveCreditTransactionsForDelivery(tenantId, 'delivery', deliveryId, t);
    const totalCharged = charges.reduce((s, c) => s + num(c.amount), 0);
    const totalCredited = credits.reduce((s, c) => s + num(c.amount), 0) + amount;
    const outstanding = Math.max(0, round2(totalCharged - totalCredited));
    let paymentStatus: DeliveryPaymentStatus = 'pending';
    if (totalCharged > 0 && totalCredited >= totalCharged) paymentStatus = 'paid';
    else if (totalCredited > 0) paymentStatus = 'partially_paid';

    await updateDeliveryOptimistic(
      tenantId,
      deliveryId,
      { paymentStatus, updatedAt: new Date() },
      num(delivery.version),
      t,
    );

    void import('../invoices/invoice.service.js').then((mod) =>
      (mod as { syncInvoiceStatusAfterPayment?: (a: string, b: string, c?: string) => unknown })
        .syncInvoiceStatusAfterPayment?.(tenantId, delivery.customerId, effectiveDate),
    );

    return { transaction: txn, paymentStatus, outstanding };
  };
  return tx ? await run(tx) : await withTransaction(run);
}

/** Mark pending deliveries on/before `cutoff` as `missed` (end-of-day). */
export async function markMissedDeliveries(tenantId: string, cutoff: string, tx?: DrizzleTx) {
  return markMissedDeliveriesRepo(tenantId, cutoff, tx);
}

/** Delivery summary for a customer over a date range. */
export async function getCustomerDeliverySummary(
  tenantId: string,
  input: { customerId: string; fromDate?: string | null; toDate?: string | null },
  dbOrTx: DBOrTx = db,
) {
  const to = input.toDate ?? toDateOnlyString(istToday());
  const from = input.fromDate ?? '0001-01-01';
  return aggregateCustomerDeliveries(tenantId, input.customerId, from, to, dbOrTx);
}

// ---- stock helpers ----

async function restoreStock(
  tenantId: string,
  variantId: string | null | undefined,
  productId: string | null | undefined,
  qty: number,
  t: DrizzleTx,
): Promise<void> {
  if (!(qty > 0)) return;
  if (variantId) {
    await incrementVariantStock(tenantId, variantId, qty, t);
  } else if (productId) {
    const updated = await incrementProductStockRow(tenantId, productId, qty, t);
    if ((updated as unknown[]).length === 0) {
      // product may be deleted; no stock to restore.
    }
  }
}

async function decrementStock(
  tenantId: string,
  variantId: string | null | undefined,
  productId: string | null | undefined,
  qty: number,
  t: DrizzleTx,
): Promise<void> {
  if (!(qty > 0)) return;
  if (variantId) {
    await decrementVariantStock(tenantId, variantId, qty, t);
  } else if (productId) {
    const updated = await decrementProductStockRow(tenantId, productId, qty, t);
    if ((updated as unknown[]).length === 0) throw new AppError('Insufficient stock for product', 409);
  }
}

function scheduledQtyFor(
  type: DeliveryType,
  sub: SubscriptionRow | null,
  slotConfig: SlotConfig[],
  slot?: (typeof deliveries.deliverySlot.enumValues)[number] | null,
): number {
  if (type === 'subscription') {
    if (!slotConfig.length) throw new AppError('Subscription has no delivery slot configured', 422);
    if (slot) {
      const found = slotConfig.find((c) => c.slot === slot);
      if (!found) throw new AppError(`Subscription is not configured for the ${slot} slot`, 422);
      return found.qty;
    }
    if (slotConfig.length === 1) return slotConfig[0].qty;
    throw new AppError('Multiple slots configured — specify `slot` (morning or evening)', 422);
  }
  return 0;
}

export async function confirmUnconfirmedDeliveries(
  tenantId: string,
  input: { days?: number; slot?: 'morning' | 'evening' },
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const from = toDateOnlyString(istToday());
    const to = toDateOnlyString(addDays(from, (input.days ?? 7) - 1));
    const conditions = [
      eq(deliveries.tenantId, tenantId),
      eq(deliveries.type, 'subscription'),
      eq(deliveries.status, 'pending'),
      sql`${deliveries.deliveryDate} >= ${from}`,
      sql`${deliveries.deliveryDate} <= ${to}`,
    ];
    if (input.slot) conditions.push(eq(deliveries.deliverySlot, input.slot));
    const where = and(...conditions);
    const list = await t.select().from(deliveries).where(where);
    const ids = list.map((r) => r.id);
    if (ids.length === 0) return { confirmed: 0, deliveries: [] };
    const updated = await Promise.all(
      ids.map((id) =>
        updateDeliveryOptimistic(tenantId, id, {
          status: 'extra',
          reason: `Bulk confirmed on ${from} via ${actorId}`,
          notes: `Automatically confirmed a set of pending subscriptions`,
          handledById: actorId,
          updatedAt: new Date(),
        }, num(list.find((r) => r.id === id)?.version ?? 0), t),
      ),
    );
    const confirmed = updated.filter(Boolean).length;
    const confirmedIds = ids.filter((_, i) => updated[i]);
    const deliveryItems = await findDeliveryWithItems(tenantId, confirmedIds[0] ?? ids[0], t);
    return { confirmed, deliveries: [deliveryItems] };
  };
  return tx ? await run(tx) : await withTransaction(run);
}

export async function listUnconfirmedDeliveries(
  tenantId: string,
  input: { days?: number; slot?: 'morning' | 'evening' },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [
    eq(deliveries.tenantId, tenantId),
    eq(deliveries.type, 'subscription'),
    eq(deliveries.status, 'pending'),
    sql`${deliveries.deliveryDate} <= ${toDateOnlyString(istToday())}`,
  ];
  if (input.slot) conditions.push(eq(deliveries.deliverySlot, input.slot));
  const where = and(...conditions);
  const results = await dbOrTx.select().from(deliveries).where(where);
  return results;
}

export function isEveningOpen(date: string): boolean {
  const dayOfWeek = new Date(date).getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}
