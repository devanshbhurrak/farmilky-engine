import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { logger } from '../../shared/utils/logger.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import {
  differenceInCalendarDays,
  istToday,
  normalizeDate,
  round2,
  toDateOnlyString,
} from '../../shared/utils/dateUtils.js';
import { getHolidayDateSet } from '../holidays/holiday.service.js';
import {
  createVariantRows,
  findProductById,
  findVariantById,
  findVariantsByProductId,
  incrementVariantStockRow,
} from '../products/product.repository.js';
import { decrementVariantStock, resolvePrice } from '../products/product.service.js';
import { decrementProductStockRow, findOrderItemsForBoard, incrementProductStockRow, type Order } from '../orders/order.repository.js';
import { getTenantSettings } from '../tenants/tenant.settings.js';
import { transactionService } from '../transactions/transaction.service.js';
import type { Subscription, SubscriptionDelivery, UserAddress } from '../../shared/db/schema/index.js';
import type { subscriptionChanges } from '../../shared/db/schema/index.js';
import {
  advanceToNextDue,
  calculateNextDeliveryDate,
  isSubscriptionDueOnDate,
} from './subscription.schedule.js';
import {
  countSubscriptionsAdmin,
  deleteDeliveryRow,
  findActiveTransactionByReference,
  findBoardAddresses,
  findBoardAreas,
  findBoardProducts,
  findBoardUsers,
  findDeliveriesForDate,
  findDeliveryById,
  findDeliveryBySubscriptionAndDate,
  findSubscriptionById,
  insertDelivery,
  insertSubscription,
  insertSubscriptionChange,
  insertSubscriptionSlots,
  listActiveSubscriptionsByUser,
  listActiveSubscriptionsDue,
  listDeliveriesBySubscription,
  listFutureDeliveriesFrom,
  listSubscriptionChanges,
  listSubscriptionSlots,
  listSubscriptionSlotsForSubs,
  listSubscriptionsAdmin,
  listSubscriptionsByUser,
  updateSubscriptionRow,
  updateSubscriptionSlotQty,
} from './subscription.repository.js';
import type {
  AdminCreateSubscriptionInput,
  AdminUpdateSubscriptionInput,
  AgentDeliveryOutcomeInput,
  CreateSubscriptionInput,
  DeliveryOutcomeInput,
  ScheduleChangeInput,
} from './subscription.schema.js';

export { advanceToNextDue, calculateNextDeliveryDate, isSubscriptionDueOnDate };

// Fire-and-forget invoice refresh after ledger-mutating subscription flows.
// Dynamic import avoids a hard subscriptions→invoices module cycle.
function syncInvoiceSoon(tenantId: string, userId: string): void {
  void import('../invoices/invoice.service.js')
    .then((mod) =>
      (mod as { syncInvoiceStatusAfterPayment?: (t: string, u: string) => unknown }).syncInvoiceStatusAfterPayment?.(
        tenantId,
        userId,
      ),
    )
    .catch((err: unknown) => logger.error({ err }, 'Invoice sync failed after subscription change'));
}

type ChangeType = typeof subscriptionChanges.$inferInsert['changeType'];

function todayStr(): string {
  return toDateOnlyString(istToday());
}

const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));

async function loadSubscription(tenantId: string, id: string, dbOrTx: DBOrTx) {
  const sub = await findSubscriptionById(tenantId, id, dbOrTx);
  if (!sub) throw new AppError('Subscription not found', 404);
  return sub;
}

type DeliverySlot = 'morning' | 'evening';
type SlotConfig = { slot: DeliverySlot; qty: number };

/**
 * Normalize slot configuration for create: accepts either the new
 * `deliverySlots` array (per-slot quantities) or the legacy single
 * `deliverySlot` + top-level quantity. Returns slots in input order; the
 * first entry becomes the subscription's primary slot.
 */
function resolveSlotConfig(input: {
  deliverySlot?: DeliverySlot;
  deliverySlots?: Array<{ slot: DeliverySlot; quantityPerDelivery?: number }>;
  quantityPerDelivery: number;
}): SlotConfig[] {
  if (input.deliverySlots?.length) {
    const seen = new Set<string>();
    return input.deliverySlots.map((entry) => {
      if (seen.has(entry.slot)) throw new AppError(`Duplicate slot: ${entry.slot}`, 422);
      seen.add(entry.slot);
      return { slot: entry.slot, qty: entry.quantityPerDelivery ?? input.quantityPerDelivery };
    });
  }
  if (!input.deliverySlot) {
    throw new AppError('deliverySlot or deliverySlots is required', 422);
  }
  return [{ slot: input.deliverySlot, qty: input.quantityPerDelivery }];
}

/**
 * Resolve the effective slot configuration for an existing subscription,
 * falling back to the legacy row values when no child rows exist yet.
 */
async function loadSlotConfig(
  tenantId: string,
  sub: Subscription,
  dbOrTx: DBOrTx,
): Promise<SlotConfig[]> {
  const rows = await listSubscriptionSlots(tenantId, sub.id, dbOrTx);
  if (rows.length > 0) {
    return rows.map((r) => ({
      slot: r.deliverySlot as DeliverySlot,
      qty: num(r.quantityPerDelivery),
    }));
  }
  return [{ slot: sub.deliverySlot as DeliverySlot, qty: num(sub.quantityPerDelivery) }];
}

async function syncSingleSlotQuantity(
  tenantId: string,
  sub: Subscription,
  qty: number,
  dbOrTx: DBOrTx,
) {
  const rows = await listSubscriptionSlots(tenantId, sub.id, dbOrTx);
  if (rows.length === 1) {
    await updateSubscriptionSlotQty(tenantId, sub.id, rows[0].deliverySlot, String(qty), dbOrTx);
  } else if (rows.length === 0) {
    await insertSubscriptionSlots(
      tenantId,
      [{ subscriptionId: sub.id, deliverySlot: sub.deliverySlot, quantityPerDelivery: String(qty) }],
      dbOrTx,
    );
  }
}

function assertOwnerOrAdmin(sub: Subscription, requesterId: string | undefined, isAdmin: boolean) {
  if (isAdmin) return;
  if (!requesterId || sub.userId !== requesterId) {
    throw new AppError('Forbidden', 403);
  }
}

async function audit(
  tenantId: string,
  subscriptionId: string,
  changeType: ChangeType,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  opts: { effectiveDate?: string | null; reason?: string | null; changedById?: string | null },
  dbOrTx: DBOrTx,
) {
  return insertSubscriptionChange(
    tenantId,
    {
      subscriptionId,
      changeType,
      oldValue,
      newValue,
      effectiveDate: opts.effectiveDate ?? null,
      reason: opts.reason ?? null,
      changedById: opts.changedById ?? null,
    },
    dbOrTx,
  );
}

async function resolveSubscriptionVariant(
  tenantId: string,
  productId: string,
  variantId: string | null | undefined,
  dbOrTx: DBOrTx,
) {
  const product = await findProductById(tenantId, productId, dbOrTx);
  if (!product) throw new AppError('Product not found', 404);
  if (variantId) {
    const variant = await findVariantById(tenantId, variantId, dbOrTx);
    if (!variant || variant.productId !== productId) {
      throw new AppError('Product variant not found', 404);
    }
    return { product, variant };
  }
  const variants = await findVariantsByProductId(tenantId, productId, dbOrTx);
  if (variants.length === 0) {
    // Lazy migration: products created before the variant requirement may
    // have no variant rows. Auto-create a default variant from the product's
    // own properties so subscriptions can still be created.
    const created = await createVariantRows(tenantId, productId, [
      {
        label: product.name,
        quantity: 1,
        unit: product.unit,
        price: product.basePrice ?? 0,
        stock: product.stock ?? 0,
        isDefault: true,
        isAvailable: true,
        sortOrder: 0,
      },
    ], dbOrTx);
    return { product, variant: created[0] };
  }
  const variant = variants.find((v) => v.isDefault) ?? variants[0];
  if (!variant) throw new AppError('No variants available for product', 404);
  return { product, variant };
}

async function decrementStockForDelivery(
  tenantId: string,
  variantId: string | null | undefined,
  productId: string,
  qty: number,
  dbOrTx: DBOrTx,
): Promise<void> {
  if (!(qty > 0)) return;
  if (variantId) {
    await decrementVariantStock(tenantId, variantId, qty, dbOrTx);
    return;
  }
  const updated = await decrementProductStockRow(tenantId, productId, qty, dbOrTx);
  if (updated.length === 0) {
    throw new AppError('Insufficient stock for product', 409);
  }
}

/**
 * Inverse of decrementStockForDelivery: puts back stock consumed by a
 * previous chargeable outcome (re-record replaces it, history delete removes
 * it). Warns instead of throwing when the product/variant row is gone —
 * there is no stock left to restore in that case.
 */
async function restoreStockForDelivery(
  tenantId: string,
  variantId: string | null | undefined,
  productId: string | null | undefined,
  qty: number,
  dbOrTx: DBOrTx,
): Promise<void> {
  if (!(qty > 0)) return;
  if (variantId) {
    const rows = await incrementVariantStockRow(tenantId, variantId, qty, dbOrTx);
    if (rows.length === 0) {
      logger.warn({ tenantId, variantId }, 'Stock restore skipped — variant row missing');
    }
    return;
  }
  if (!productId) {
    logger.warn({ tenantId }, 'Stock restore skipped — no product reference');
    return;
  }
  const rows = await incrementProductStockRow(tenantId, productId, qty, dbOrTx);
  if (rows.length === 0) {
    logger.warn({ tenantId, productId }, 'Stock restore skipped — product row missing/deleted');
  }
}

function isChargeableOutcome(status: string): boolean {
  return status === 'delivered' || status === 'partial' || status === 'extra';
}

function snapshotOf(
  sub: Subscription,
  slots?: Array<{ deliverySlot: string; quantityPerDelivery: string }>,
): Record<string, unknown> {
  return {
    productId: sub.productId,
    variantId: sub.variantId,
    quantityPerDelivery: sub.quantityPerDelivery,
    deliverySlot: sub.deliverySlot,
    deliverySlots: slots?.length
      ? slots.map((s) => ({
          slot: s.deliverySlot,
          quantityPerDelivery: num(s.quantityPerDelivery),
        }))
      : undefined,
    deliverySchedule: sub.deliverySchedule,
    customDays: sub.customDays,
    startDate: sub.startDate,
    nextDeliveryDate: sub.nextDeliveryDate,
    pricePerPacket: sub.pricePerPacket,
    totalPricePerDelivery: sub.totalPricePerDelivery,
    status: sub.status,
  };
}

// ---------- create ----------

export async function createSubscription(
  tenantId: string,
  userId: string,
  input: CreateSubscriptionInput & { customPrice?: number },
  adminId?: string | null,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const holidays = await getHolidayDateSet(tenantId, t);
    const { variant } = await resolveSubscriptionVariant(
      tenantId,
      input.productId,
      input.variantId,
      t,
    );

    let price: number;
    let isCustom: boolean;
    if (input.customPrice !== undefined && input.customPrice !== null) {
      price = input.customPrice;
      isCustom = true;
    } else {
      const resolved = await resolvePrice(tenantId, userId, variant.id, t);
      price = resolved.price;
      isCustom = resolved.isCustom;
    }

    const startDate = input.startDate ?? todayStr();
    const schedule = input.deliverySchedule ?? 'daily';
    const customDays = input.customDays ?? [];
    const nextDeliveryDate = toDateOnlyString(
      calculateNextDeliveryDate({ deliverySchedule: schedule, customDays }, startDate, holidays),
    );
    const slotConfig = resolveSlotConfig(input);
    // Row-level quantity is the daily total across slots; per-slot
    // quantities live on the subscription_slots rows.
    const qty = round2(slotConfig.reduce((sum, s) => sum + s.qty, 0));
    const total = round2(qty * price);

    const sub = await insertSubscription(
      tenantId,
      {
        userId,
        productId: input.productId,
        variantId: variant.id,
        areaId: input.areaId ?? null,
        variantLabel: variant.label,
        variantUnit: variant.unit,
        variantQuantity: String(variant.quantity),
        quantityPerDelivery: String(qty),
        deliverySlot: slotConfig[0].slot,
        deliverySchedule: schedule,
        customDays,
        startDate,
        nextDeliveryDate,
        pricePerPacket: price.toFixed(2),
        totalPricePerDelivery: total.toFixed(2),
        isCustomPrice: isCustom,
        status: 'active',
        skippedDates: [],
        createdById: adminId ?? userId,
      },
      t,
    );
    const slotRows = await insertSubscriptionSlots(
      tenantId,
      slotConfig.map((s) => ({
        subscriptionId: sub.id,
        deliverySlot: s.slot,
        quantityPerDelivery: String(s.qty),
      })),
      t,
    );
    await audit(tenantId, sub.id, 'created', {}, snapshotOf(sub, slotRows), {
      changedById: adminId ?? userId,
    }, t);
    return sub;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function adminCreateSubscription(
  tenantId: string,
  input: AdminCreateSubscriptionInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  return createSubscription(tenantId, input.userId, input, adminId, tx);
}

// ---------- delivery outcomes ----------

export async function recordDeliveryOutcome(
  subscriptionId: string,
  tenantId: string,
  params: DeliveryOutcomeInput,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const chargeable =
      params.status === 'delivered' || params.status === 'partial' || params.status === 'extra';
    // Money may only move for active subscriptions. Operational history
    // (skipped/failed) is still recorded so manifests stay accurate.
    if (chargeable && sub.status !== 'active') {
      throw new AppError('Only active subscriptions can be billed for a delivery', 409);
    }

    // Resolve which slot this outcome belongs to and its scheduled quantity.
    // Single-slot subscriptions default to their only slot; multi-slot ones
    // require an explicit `slot`.
    const slotConfig = await loadSlotConfig(tenantId, sub, t);
    let slot: DeliverySlot;
    if (params.slot) {
      if (!slotConfig.some((c) => c.slot === params.slot)) {
        throw new AppError(`Subscription is not configured for the ${params.slot} slot`, 422);
      }
      slot = params.slot;
    } else if (slotConfig.length === 1) {
      slot = slotConfig[0].slot;
    } else {
      throw new AppError('Multiple slots configured — specify `slot` (morning or evening)', 422);
    }
    const slotQty = slotConfig.find((c) => c.slot === slot)!.qty;

    const existing = await findDeliveryBySubscriptionAndDate(
      tenantId,
      subscriptionId,
      params.deliveryDate,
      slot,
      t,
    );
    if (existing) {
      if (isChargeableOutcome(existing.status)) {
        const linked = await findActiveTransactionByReference(
          tenantId,
          'subscription_delivery',
          existing.id,
          t,
        );
        if (linked) {
          await transactionService.voidTransaction(
            linked.id,
            tenantId,
            params.reason?.trim() ? params.reason : 'Delivery outcome re-recorded',
            actorId,
            t,
          );
        }
        // The old outcome consumed stock — put it back before the new outcome
        // decrements again.
        await restoreStockForDelivery(
          tenantId,
          sub.variantId,
          sub.productId,
          num(existing.actualQuantity),
          t,
        );
      }
      await deleteDeliveryRow(tenantId, existing.id, t);
    }

    let qty: number;
    if (params.status === 'partial' || params.status === 'extra') {
      if (params.actualQuantity === undefined || !(params.actualQuantity > 0)) {
        throw new AppError('actualQuantity must be positive for partial/extra outcomes', 422);
      }
      qty = params.actualQuantity;
      // Quantity bounds against the scheduled quantity for this slot: partial
      // must be strictly less than scheduled; extra has a 3x ceiling.
      if (params.status === 'partial' && qty >= slotQty) {
        throw new AppError('Partial delivery quantity must be less than scheduled', 422);
      }
      if (params.status === 'extra' && qty > slotQty * 3) {
        throw new AppError('Extra delivery quantity exceeds allowed ceiling', 422);
      }
    } else if (params.status === 'delivered') {
      qty = slotQty;
    } else {
      qty = 0;
    }
    const price = num(sub.pricePerPacket);
    const amount = round2(qty * price);
    const isZero = params.status === 'skipped' || params.status === 'failed';

    const delivery = await insertDelivery(
      tenantId,
      {
        subscriptionId,
        deliveryDate: params.deliveryDate,
        deliverySlot: slot,
        status: params.status,
        scheduledQuantity: String(slotQty),
        actualQuantity: isZero ? '0' : String(qty),
        pricePerPacket: sub.pricePerPacket,
        totalAmount: amount.toFixed(2),
        reason: params.reason ?? null,
        notes: params.notes ?? null,
        handledById: actorId,
      },
      t,
    );

    let transactionId: string | null = null;
    if (
      (params.status === 'delivered' || params.status === 'partial' || params.status === 'extra') &&
      amount > 0
    ) {
      const txn = await transactionService.createTransaction(
        {
          tenantId,
          partyType: 'customer',
          partyId: sub.userId,
          txnType: 'delivery',
          entryType: 'debit',
          amount,
          effectiveDate: params.deliveryDate,
          referenceType: 'subscription_delivery',
          referenceId: delivery.id,
          description: `Subscription delivery ${params.deliveryDate}`,
          notes: params.notes ?? null,
          createdById: actorId,
          items: [
            {
              description: 'Subscription delivery',
              quantity: qty,
              rate: price,
              amount,
              referenceType: 'subscription_delivery',
              referenceId: delivery.id,
            },
          ],
        },
        t,
      );
      transactionId = txn.id;
      // Mirror orders: decrement inventory on chargeable delivery outcomes
      // (delivered/partial/extra) so subscription stock never drifts.
      await decrementStockForDelivery(tenantId, sub.variantId, sub.productId, qty, t);
    }

    if (params.deliveryDate >= todayStr()) {
      const holidays = await getHolidayDateSet(tenantId, t);
      // Skip-aware: next never lands on a holiday, vacation day or skip date.
      const next = toDateOnlyString(advanceToNextDue(sub, params.deliveryDate, holidays));
      await updateSubscriptionRow(tenantId, subscriptionId, { nextDeliveryDate: next }, t);
    }

    await audit(
      tenantId,
      subscriptionId,
      'delivery',
      existing
        ? { deliveryId: existing.id, status: existing.status, date: existing.deliveryDate }
        : {},
      { deliveryId: delivery.id, status: delivery.status, date: delivery.deliveryDate },
      { reason: params.reason ?? null, changedById: actorId },
      t,
    );
    return { delivery, transactionId, userId: sub.userId };
  };
  if (tx) return run(tx);
  const result = await withTransaction(run);
  // Refresh the covering invoice once the ledger write is committed.
  if (result.transactionId) syncInvoiceSoon(tenantId, result.userId);
  return result;
}

export async function recordAgentDeliveryOutcome(
  subscriptionId: string,
  tenantId: string,
  input: AgentDeliveryOutcomeInput,
  actorId: string,
  tx?: DrizzleTx,
) {
  return recordDeliveryOutcome(
    subscriptionId,
    tenantId,
    {
      deliveryDate: input.deliveryDate ?? todayStr(),
      status: input.status,
      notes: input.notes,
      ...(input.slot ? { slot: input.slot } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    actorId,
    tx,
  );
}

export async function markDeliveredToday(
  subscriptionId: string,
  tenantId: string,
  actorId: string,
  tx?: DrizzleTx,
) {
  return recordDeliveryOutcome(
    subscriptionId,
    tenantId,
    { deliveryDate: todayStr(), status: 'delivered' },
    actorId,
    tx,
  );
}

export async function deleteDeliveryHistoryEntry(
  subscriptionId: string,
  entryId: string,
  tenantId: string,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const entry = await findDeliveryById(tenantId, subscriptionId, entryId, t);
    if (!entry) throw new AppError('Delivery entry not found', 404);

    const linked = await findActiveTransactionByReference(
      tenantId,
      'subscription_delivery',
      entry.id,
      t,
    );
    if (linked) {
      await transactionService.voidTransaction(
        linked.id,
        tenantId,
        'Delivery history entry deleted',
        adminId,
        t,
      );
    }
    if (isChargeableOutcome(entry.status)) {
      // The deleted outcome had consumed stock — restore it.
      await restoreStockForDelivery(
        tenantId,
        sub.variantId,
        sub.productId,
        num(entry.actualQuantity),
        t,
      );
    }
    await deleteDeliveryRow(tenantId, entry.id, t);

    // Next = first due date on/after the latest remaining history (or today),
    // skip-aware so it never lands on a holiday/vacation/skip date.
    const today = todayStr();
    const remaining = await listFutureDeliveriesFrom(tenantId, subscriptionId, '0001-01-01', t);
    const lastDate = remaining.reduce(
      (max, r) => (r.deliveryDate > max ? r.deliveryDate : max),
      today,
    );
    const base = lastDate > today ? lastDate : today;
    const holidays = await getHolidayDateSet(tenantId, t);
    const next = toDateOnlyString(advanceToNextDue(sub, base, holidays));
    await updateSubscriptionRow(tenantId, subscriptionId, { nextDeliveryDate: next }, t);
    await audit(
      tenantId,
      subscriptionId,
      'correction',
      { deliveryId: entry.id, status: entry.status, date: entry.deliveryDate },
      { nextDeliveryDate: next },
      { reason: 'Delivery history entry deleted', changedById: adminId },
      t,
    );
    return { deleted: true, nextDeliveryDate: next, userId: sub.userId, hadTransaction: Boolean(linked) };
  };
  if (tx) return run(tx);
  const result = await withTransaction(run);
  if (result.hadTransaction) syncInvoiceSoon(tenantId, result.userId);
  return result;
}

// ---------- scheduled future change ----------

export async function scheduleSubscriptionChange(
  tenantId: string,
  subscriptionId: string,
  input: ScheduleChangeInput,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    if (sub.status !== 'active') {
      throw new AppError('Only active subscriptions can have scheduled changes', 409);
    }
    if (!(input.effectiveDate > todayStr())) {
      throw new AppError('effectiveDate must be in the future', 422);
    }
    // scheduledQty targets one slot. Single-slot subscriptions default to
    // their only slot; multi-slot ones must specify which one.
    let scheduledSlot: DeliverySlot | null = null;
    if (input.scheduledQty !== undefined) {
      const slotConfig = await loadSlotConfig(tenantId, sub, t);
      if (input.slot) {
        if (!slotConfig.some((c) => c.slot === input.slot)) {
          throw new AppError(`Subscription is not configured for the ${input.slot} slot`, 422);
        }
        scheduledSlot = input.slot;
      } else if (slotConfig.length === 1) {
        scheduledSlot = slotConfig[0].slot;
      } else {
        throw new AppError('Multiple slots configured — specify `slot` for scheduledQty', 422);
      }
    }
    const updated = await updateSubscriptionRow(
      tenantId,
      subscriptionId,
      {
        scheduledQty:
          input.scheduledQty !== undefined ? String(input.scheduledQty) : sub.scheduledQty,
        scheduledPrice:
          input.scheduledPrice !== undefined
            ? round2(input.scheduledPrice).toFixed(2)
            : sub.scheduledPrice,
        scheduledSlot: input.scheduledQty !== undefined ? scheduledSlot : sub.scheduledSlot,
        scheduledChangeDate: input.effectiveDate,
      },
      t,
    );
    await audit(
      tenantId,
      subscriptionId,
      'schedule',
      {
        scheduledQty: sub.scheduledQty,
        scheduledPrice: sub.scheduledPrice,
        scheduledSlot: sub.scheduledSlot,
        scheduledChangeDate: sub.scheduledChangeDate,
      },
      {
        scheduledQty: updated!.scheduledQty,
        scheduledPrice: updated!.scheduledPrice,
        scheduledSlot: updated!.scheduledSlot,
        scheduledChangeDate: updated!.scheduledChangeDate,
      },
      { effectiveDate: input.effectiveDate, changedById: actorId },
      t,
    );
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function cancelScheduledChange(
  tenantId: string,
  subscriptionId: string,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const updated = await updateSubscriptionRow(
      tenantId,
      subscriptionId,
      { scheduledQty: null, scheduledPrice: null, scheduledSlot: null, scheduledChangeDate: null },
      t,
    );
    await audit(
      tenantId,
      subscriptionId,
      'schedule',
      {
        scheduledQty: sub.scheduledQty,
        scheduledPrice: sub.scheduledPrice,
        scheduledSlot: sub.scheduledSlot,
        scheduledChangeDate: sub.scheduledChangeDate,
      },
      { scheduledQty: null, scheduledPrice: null, scheduledSlot: null, scheduledChangeDate: null },
      { reason: 'Scheduled change cancelled', changedById: actorId },
      t,
    );
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

// ---------- vacation & skip ----------

export async function setVacation(
  tenantId: string,
  subscriptionId: string,
  input: { vacationFrom: string; vacationUntil: string },
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    if (sub.status !== 'active') {
      throw new AppError('Only active subscriptions can take a vacation', 409);
    }
    if (!(input.vacationFrom >= todayStr())) {
      throw new AppError('vacationFrom must be today or later', 422);
    }
    if (!(input.vacationFrom < input.vacationUntil)) {
      throw new AppError('vacationFrom must be before vacationUntil', 422);
    }
    // Per-tenant override lives in tenants.tenant_settings.vacationMaxDays.
    const { vacationMaxDays: VACATION_MAX_DAYS } = await getTenantSettings(tenantId, t);
    const spanDays = differenceInCalendarDays(
      normalizeDate(input.vacationUntil),
      normalizeDate(input.vacationFrom),
    );
    if (spanDays > VACATION_MAX_DAYS) {
      throw new AppError(`Vacation cannot exceed ${VACATION_MAX_DAYS} days`, 422);
    }
    const patch: Partial<Subscription> = {
      vacationFrom: input.vacationFrom,
      vacationUntil: input.vacationUntil,
    };
    // If the current next date falls inside the new vacation, push it past.
    if (sub.nextDeliveryDate >= input.vacationFrom && sub.nextDeliveryDate <= input.vacationUntil) {
      const holidays = await getHolidayDateSet(tenantId, t);
      patch.nextDeliveryDate = toDateOnlyString(
        advanceToNextDue(
          { ...sub, vacationFrom: input.vacationFrom, vacationUntil: input.vacationUntil },
          input.vacationUntil,
          holidays,
        ),
      );
    }
    const updated = await updateSubscriptionRow(tenantId, subscriptionId, patch, t);
    await audit(
      tenantId,
      subscriptionId,
      'schedule',
      {
        vacationFrom: sub.vacationFrom,
        vacationUntil: sub.vacationUntil,
        nextDeliveryDate: sub.nextDeliveryDate,
      },
      {
        vacationFrom: input.vacationFrom,
        vacationUntil: input.vacationUntil,
        nextDeliveryDate: updated!.nextDeliveryDate,
      },
      { changedById: actorId },
      t,
    );
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function cancelVacation(
  tenantId: string,
  subscriptionId: string,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const updated = await updateSubscriptionRow(
      tenantId,
      subscriptionId,
      { vacationFrom: null, vacationUntil: null },
      t,
    );
    // Recompute next from the post-vacation state so a stale date inside the
    // old window can never strand the subscription.
    const holidays = await getHolidayDateSet(tenantId, t);
    const base =
      normalizeDate(updated!.nextDeliveryDate) < normalizeDate(todayStr())
        ? todayStr()
        : updated!.nextDeliveryDate;
    const next = toDateOnlyString(
      advanceToNextDue({ ...updated!, vacationFrom: null, vacationUntil: null }, base, holidays),
    );
    const final =
      next === updated!.nextDeliveryDate
        ? updated
        : await updateSubscriptionRow(tenantId, subscriptionId, { nextDeliveryDate: next }, t);
    await audit(
      tenantId,
      subscriptionId,
      'schedule',
      { vacationFrom: sub.vacationFrom, vacationUntil: sub.vacationUntil },
      { vacationFrom: null, vacationUntil: null, nextDeliveryDate: final!.nextDeliveryDate },
      { reason: 'Vacation cancelled', changedById: actorId },
      t,
    );
    return final;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function skipDeliveryDate(
  tenantId: string,
  subscriptionId: string,
  date: string,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    if (sub.status !== 'active') {
      throw new AppError('Only active subscriptions can skip a delivery', 409);
    }
    if (!(date >= todayStr())) throw new AppError('Cannot skip a past date', 422);
    const skipped = [...(sub.skippedDates ?? [])];
    if (!skipped.includes(date)) skipped.push(date);
    const patch: Partial<Subscription> = { skippedDates: skipped };
    if (normalizeDate(sub.nextDeliveryDate).getTime() === normalizeDate(date).getTime()) {
      const holidays = await getHolidayDateSet(tenantId, t);
      patch.nextDeliveryDate = toDateOnlyString(
        advanceToNextDue({ ...sub, skippedDates: skipped }, date, holidays),
      );
    }
    const updated = await updateSubscriptionRow(tenantId, subscriptionId, patch, t);
    await audit(
      tenantId,
      subscriptionId,
      'schedule',
      { skippedDates: sub.skippedDates, nextDeliveryDate: sub.nextDeliveryDate },
      { skippedDates: skipped, nextDeliveryDate: updated!.nextDeliveryDate },
      { reason: `Skipped ${date}`, changedById: actorId },
      t,
    );
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function unskipDeliveryDate(
  tenantId: string,
  subscriptionId: string,
  date: string,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const skipped = (sub.skippedDates ?? []).filter((d) => d !== date);
    const patch: Partial<Subscription> = { skippedDates: skipped };
    // Restore service for the unskipped date when it precedes the current
    // next date (skip had pushed next past it).
    if (date >= todayStr() && normalizeDate(date) < normalizeDate(sub.nextDeliveryDate)) {
      const holidays = await getHolidayDateSet(tenantId, t);
      patch.nextDeliveryDate = toDateOnlyString(
        advanceToNextDue({ ...sub, skippedDates: skipped }, date, holidays),
      );
    }
    const updated = await updateSubscriptionRow(tenantId, subscriptionId, patch, t);
    await audit(
      tenantId,
      subscriptionId,
      'schedule',
      { skippedDates: sub.skippedDates, nextDeliveryDate: sub.nextDeliveryDate },
      { skippedDates: skipped, nextDeliveryDate: updated!.nextDeliveryDate },
      { reason: `Unskipped ${date}`, changedById: actorId },
      t,
    );
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

// ---------- pause / resume / cancel ----------

async function pauseOne(
  t: DBOrTx,
  tenantId: string,
  sub: Subscription,
  reason: string | undefined,
  actorId: string,
) {
  if (sub.status !== 'active') throw new AppError('Only active subscriptions can be paused', 400);
  const updated = await updateSubscriptionRow(
    tenantId,
    sub.id,
    { status: 'paused', pauseReason: reason ?? null },
    t,
  );
  await audit(tenantId, sub.id, 'status', { status: sub.status }, { status: 'paused' }, {
    reason: reason ?? null,
    changedById: actorId,
  }, t);
  return updated;
}

async function resumeOne(
  t: DBOrTx,
  tenantId: string,
  sub: Subscription,
  actorId: string,
  holidays: Set<number> | null = null,
) {
  if (sub.status !== 'paused') throw new AppError('Only paused subscriptions can be resumed', 400);
  const today = todayStr();
  const base =
    normalizeDate(sub.nextDeliveryDate) < normalizeDate(today) ? today : sub.nextDeliveryDate;
  const next = toDateOnlyString(
    advanceToNextDue({ ...sub, status: 'active' }, base, holidays),
  );
  const updated = await updateSubscriptionRow(
    tenantId,
    sub.id,
    { status: 'active', pauseReason: null, nextDeliveryDate: next },
    t,
  );
  await audit(tenantId, sub.id, 'status', { status: sub.status }, { status: 'active' }, {
    reason: 'Resumed',
    changedById: actorId,
  }, t);
  return updated;
}

export async function pauseSubscription(
  tenantId: string,
  subscriptionId: string,
  reason: string | undefined,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    return pauseOne(t, tenantId, sub, reason, actorId);
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function resumeSubscription(
  tenantId: string,
  subscriptionId: string,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const holidays = await getHolidayDateSet(tenantId, t);
    return resumeOne(t, tenantId, sub, actorId, holidays);
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function cancelSubscription(
  tenantId: string,
  subscriptionId: string,
  actorId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    if (sub.status === 'cancelled') throw new AppError('Subscription is already cancelled', 400);
    const updated = await updateSubscriptionRow(
      tenantId,
      subscriptionId,
      { status: 'cancelled' },
      t,
    );
    await audit(tenantId, subscriptionId, 'status', { status: sub.status }, { status: 'cancelled' }, {
      reason: 'Cancelled',
      changedById: actorId,
    }, t);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function bulkPauseSubscriptions(
  tenantId: string,
  ids: string[],
  actorId: string,
  reason?: string,
) {
  return withTransaction(async (t) => {
    let updated = 0;
    for (const id of [...new Set(ids)]) {
      const sub = await loadSubscription(tenantId, id, t);
      await pauseOne(t, tenantId, sub, reason, actorId);
      updated += 1;
    }
    return { updated };
  });
}

export async function bulkResumeSubscriptions(tenantId: string, ids: string[], actorId: string) {
  return withTransaction(async (t) => {
    const holidays = await getHolidayDateSet(tenantId, t);
    let updated = 0;
    for (const id of [...new Set(ids)]) {
      const sub = await loadSubscription(tenantId, id, t);
      await resumeOne(t, tenantId, sub, actorId, holidays);
      updated += 1;
    }
    return { updated };
  });
}

// ---------- updates ----------

export async function updateSubscriptionSchedule(
  tenantId: string,
  subscriptionId: string,
  requesterId: string,
  input: { quantityPerDelivery?: number; deliverySchedule?: string; customDays?: string[] },
  isAdmin = false,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    assertOwnerOrAdmin(sub, requesterId, isAdmin);
    const patch: Partial<Subscription> = {};
    if (input.quantityPerDelivery !== undefined) {
      const slotRows = await listSubscriptionSlots(tenantId, subscriptionId, t);
      if (slotRows.length > 1) {
        throw new AppError(
          'Multi-slot subscriptions must update quantities per slot via the admin update endpoint',
          422,
        );
      }
      patch.quantityPerDelivery = String(input.quantityPerDelivery);
      // Keep the per-slot row in sync with the row-level quantity.
      await syncSingleSlotQuantity(tenantId, sub, input.quantityPerDelivery, t);
    }
    if (input.deliverySchedule !== undefined) {
      patch.deliverySchedule = input.deliverySchedule as Subscription['deliverySchedule'];
    }
    if (input.customDays !== undefined) patch.customDays = input.customDays;
    const effectiveSchedule = (patch.deliverySchedule ?? sub.deliverySchedule) as string;
    const effectiveDays = patch.customDays ?? sub.customDays ?? [];
    if (effectiveSchedule === 'custom' && effectiveDays.length === 0) {
      throw new AppError('customDays is required for custom schedule', 422);
    }
    const qty = num((patch.quantityPerDelivery as string | undefined) ?? sub.quantityPerDelivery);
    patch.totalPricePerDelivery = round2(qty * num(sub.pricePerPacket)).toFixed(2);
    // A new schedule invalidates the old next date — recompute skip-aware.
    if (patch.deliverySchedule !== undefined || patch.customDays !== undefined) {
      const holidays = await getHolidayDateSet(tenantId, t);
      patch.nextDeliveryDate = toDateOnlyString(
        advanceToNextDue(
          {
            ...sub,
            deliverySchedule: (patch.deliverySchedule ?? sub.deliverySchedule) as never,
            customDays: patch.customDays ?? sub.customDays ?? [],
          },
          normalizeDate(sub.nextDeliveryDate) < normalizeDate(todayStr())
            ? todayStr()
            : sub.nextDeliveryDate,
          holidays,
        ),
      );
    }
    const updated = await updateSubscriptionRow(tenantId, subscriptionId, patch, t);
    const before = snapshotOf(sub);
    const after = snapshotOf(updated!);
    if (before.quantityPerDelivery !== after.quantityPerDelivery) {
      await audit(tenantId, subscriptionId, 'quantity', before, after, {
        changedById: requesterId,
      }, t);
    }
    if (
      before.deliverySchedule !== after.deliverySchedule ||
      JSON.stringify(before.customDays) !== JSON.stringify(after.customDays)
    ) {
      await audit(tenantId, subscriptionId, 'schedule', before, after, {
        changedById: requesterId,
      }, t);
    }
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function adminUpdateSubscription(
  tenantId: string,
  subscriptionId: string,
  input: AdminUpdateSubscriptionInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const patch: Partial<Subscription> = {};
    const before = snapshotOf(sub);

    if (input.deliverySlot !== undefined && input.deliverySlot !== sub.deliverySlot) {
      throw new AppError(
        'Delivery slot cannot be changed. Cancel and recreate the subscription to change the slot.',
        422,
      );
    }

    const newProductId = input.productId ?? sub.productId;
    const variantChanged =
      (input.variantId !== undefined && (input.variantId ?? null) !== sub.variantId) ||
      (input.productId !== undefined && input.productId !== sub.productId);

    let price = num(sub.pricePerPacket);
    let isCustom = sub.isCustomPrice;
    if (variantChanged) {
      const newVariantId =
        input.variantId !== undefined ? input.variantId : sub.variantId;
      const { variant } = await resolveSubscriptionVariant(
        tenantId,
        newProductId,
        newVariantId,
        t,
      );
      patch.productId = newProductId;
      patch.variantId = variant.id;
      patch.variantLabel = variant.label;
      patch.variantUnit = variant.unit;
      patch.variantQuantity = String(variant.quantity);
      if (input.pricePerPacket === undefined) {
        const resolved = await resolvePrice(tenantId, sub.userId, variant.id, t);
        price = resolved.price;
        isCustom = resolved.isCustom;
      }
    } else if (input.productId !== undefined) {
      patch.productId = newProductId;
    }
    if (input.pricePerPacket !== undefined) {
      price = input.pricePerPacket;
      isCustom = true;
    }
    if (variantChanged || input.pricePerPacket !== undefined) {
      patch.pricePerPacket = price.toFixed(2);
      patch.isCustomPrice = isCustom;
    }
    // Per-slot quantity updates (multi-slot) or single-slot quantity sync.
    if (input.deliverySlots?.length) {
      const existingSlots = await listSubscriptionSlots(tenantId, subscriptionId, t);
      const existingSet = new Set(existingSlots.map((r) => r.deliverySlot));
      const inputSet = new Set(input.deliverySlots.map((s) => s.slot));
      const sameSet =
        existingSet.size === inputSet.size && [...inputSet].every((s) => existingSet.has(s));
      if (!sameSet) {
        throw new AppError(
          'Delivery slots cannot be changed. Cancel and recreate the subscription to change the slots.',
          422,
        );
      }
      for (const entry of input.deliverySlots) {
        if (entry.quantityPerDelivery !== undefined) {
          await updateSubscriptionSlotQty(
            tenantId,
            subscriptionId,
            entry.slot,
            String(entry.quantityPerDelivery),
            t,
          );
        }
      }
      const fresh = await listSubscriptionSlots(tenantId, subscriptionId, t);
      const totalQty = round2(fresh.reduce((sum, r) => sum + num(r.quantityPerDelivery), 0));
      patch.quantityPerDelivery = String(totalQty);
    } else if (input.quantityPerDelivery !== undefined) {
      const existingSlots = await listSubscriptionSlots(tenantId, subscriptionId, t);
      if (existingSlots.length > 1) {
        throw new AppError(
          'Multi-slot subscriptions must update quantities per slot via deliverySlots',
          422,
        );
      }
      patch.quantityPerDelivery = String(input.quantityPerDelivery);
      // Keep the per-slot row in sync with the row-level quantity.
      await syncSingleSlotQuantity(tenantId, sub, input.quantityPerDelivery, t);
    }
    if (input.deliverySlot !== undefined) patch.deliverySlot = input.deliverySlot;
    if (input.deliverySchedule !== undefined) {
      patch.deliverySchedule = input.deliverySchedule as Subscription['deliverySchedule'];
    }
    if (input.customDays !== undefined) patch.customDays = input.customDays;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 'active') patch.pauseReason = null;
    }
    if (input.areaId !== undefined) patch.areaId = input.areaId;

    const qty = num(
      (patch.quantityPerDelivery as string | undefined) ?? sub.quantityPerDelivery,
    );
    if (
      patch.quantityPerDelivery !== undefined ||
      patch.pricePerPacket !== undefined
    ) {
      patch.totalPricePerDelivery = round2(qty * price).toFixed(2);
    }
    if (patch.deliverySchedule !== undefined || patch.customDays !== undefined) {
      const holidays = await getHolidayDateSet(tenantId, t);
      patch.nextDeliveryDate = toDateOnlyString(
        advanceToNextDue(
          {
            ...sub,
            deliverySchedule: (patch.deliverySchedule ?? sub.deliverySchedule) as never,
            customDays: patch.customDays ?? sub.customDays ?? [],
          },
          normalizeDate(sub.nextDeliveryDate) < normalizeDate(todayStr())
            ? todayStr()
            : sub.nextDeliveryDate,
          holidays,
        ),
      );
    }

    const updated = await updateSubscriptionRow(tenantId, subscriptionId, patch, t);
    const after = snapshotOf(updated!);
    const changeType: ChangeType =
      before.variantId !== after.variantId
        ? 'variant'
        : before.pricePerPacket !== after.pricePerPacket
          ? 'price'
          : before.quantityPerDelivery !== after.quantityPerDelivery
            ? 'quantity'
            : before.deliverySchedule !== after.deliverySchedule
              ? 'schedule'
              : before.deliverySlot !== after.deliverySlot
                ? 'slot'
                : before.status !== after.status
                  ? 'status'
                  : 'correction';
    await audit(tenantId, subscriptionId, changeType, before, after, {
      changedById: adminId,
    }, t);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function adminUpdateSubscriptionStatus(
  tenantId: string,
  subscriptionId: string,
  status: 'active' | 'paused' | 'cancelled',
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const sub = await loadSubscription(tenantId, subscriptionId, t);
    const updated = await updateSubscriptionRow(
      tenantId,
      subscriptionId,
      status === 'active' ? { status, pauseReason: null } : { status },
      t,
    );
    await audit(tenantId, subscriptionId, 'status', { status: sub.status }, { status }, {
      changedById: adminId,
    }, t);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

// ---------- queries ----------

export async function listMySubscriptions(
  tenantId: string,
  userId: string,
  dbOrTx: DBOrTx = db,
) {
  return listSubscriptionsByUser(tenantId, userId, dbOrTx);
}

export async function getSubscriptionById(
  tenantId: string,
  subscriptionId: string,
  requester: { id?: string; isAdmin: boolean },
  dbOrTx: DBOrTx = db,
) {
  const sub = await loadSubscription(tenantId, subscriptionId, dbOrTx);
  assertOwnerOrAdmin(sub, requester.id, requester.isAdmin);
  const [slots, deliveries, changes] = await Promise.all([
    listSubscriptionSlots(tenantId, subscriptionId, dbOrTx),
    listDeliveriesBySubscription(tenantId, subscriptionId, dbOrTx),
    listSubscriptionChanges(tenantId, subscriptionId, dbOrTx),
  ]);
  return { ...sub, slots, deliveries, changes };
}

export async function listSubscriptionsAdminService(
  tenantId: string,
  filters: { status?: 'active' | 'paused' | 'cancelled'; search?: string },
  pagination: { page: number; limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const [items, total] = await Promise.all([
    listSubscriptionsAdmin(tenantId, filters, pagination, dbOrTx),
    countSubscriptionsAdmin(tenantId, filters, dbOrTx),
  ]);
  return { items, total };
}

export async function getTodaySupply(
  tenantId: string,
  opts: { date?: string; slot?: 'morning' | 'evening' },
  dbOrTx: DBOrTx = db,
) {
  const date = opts.date ?? todayStr();
  const candidates = await listActiveSubscriptionsDue(
    tenantId,
    { maxNextDate: date, slot: opts.slot },
    dbOrTx,
  );
  const holidays = await getHolidayDateSet(tenantId, dbOrTx);
  const due = candidates.filter((s) => isSubscriptionDueOnDate(s, date, holidays));
  // Multi-slot aware: aggregate per-slot quantities from the authoritative
  // subscription_slots rows (filtered to the requested slot when given).
  const slotRows = await listSubscriptionSlotsForSubs(
    tenantId,
    due.map((s) => s.id),
    dbOrTx,
  );
  const slotsBySub = new Map<string, Array<{ slot: DeliverySlot; quantityPerDelivery: number }>>();
  for (const row of slotRows) {
    if (opts.slot && row.deliverySlot !== opts.slot) continue;
    const list = slotsBySub.get(row.subscriptionId) ?? [];
    list.push({
      slot: row.deliverySlot as DeliverySlot,
      quantityPerDelivery: num(row.quantityPerDelivery),
    });
    slotsBySub.set(row.subscriptionId, list);
  }
  const bySlot = {
    morning: { count: 0, quantity: 0 },
    evening: { count: 0, quantity: 0 },
  };
  let totalQuantity = 0;
  const items = due.map((s) => {
    const slots =
      slotsBySub.get(s.id) ??
      (opts.slot ? [] : [{ slot: s.deliverySlot as DeliverySlot, quantityPerDelivery: num(s.quantityPerDelivery) }]);
    for (const entry of slots) {
      bySlot[entry.slot].count += 1;
      bySlot[entry.slot].quantity = round2(bySlot[entry.slot].quantity + entry.quantityPerDelivery);
      totalQuantity = round2(totalQuantity + entry.quantityPerDelivery);
    }
    return { ...s, slots };
  });
  return { date, count: due.length, totalQuantity, bySlot, items };
}

export async function getDeliveryBoard(
  tenantId: string,
  opts: { date?: string; slot?: 'morning' | 'evening' },
  orders: unknown[] = [],
  dbOrTx: DBOrTx = db,
) {
  // Pending one-time orders are merged by the controller via the orders module.
  const supply = await getTodaySupply(tenantId, opts, dbOrTx);
  return {
    date: supply.date,
    slot: opts.slot ?? null,
    subscriptions: supply.items,
    orders,
    summary: {
      subscriptionCount: supply.count,
      totalQuantity: supply.totalQuantity,
      bySlot: supply.bySlot,
      orderCount: orders.length,
    },
  };
}

export async function listActiveSubscriptionsForUser(
  tenantId: string,
  userId: string,
  dbOrTx: DBOrTx = db,
) {
  return listActiveSubscriptionsByUser(tenantId, userId, dbOrTx);
}
