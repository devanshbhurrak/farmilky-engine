import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { transactionService } from '../transactions/transaction.service.js';
import { DEFAULT_RETURN_WINDOW_MS, getTenantSettings } from '../tenants/tenant.settings.js';
import type { CreateReturnInput, ReturnListQuery, UpdateReturnStatusInput } from './return.schema.js';
import {
  findActiveReturnForOrder,
  findOrderById,
  findOrderItemsByOrderId,
  findReturnById,
  findReturnItemsByReturnId,
  insertReturn,
  insertReturnItems,
  listAllReturns,
  listReturnsByUser,
  updateReturnRow,
} from './return.repository.js';

// Fallback default; per-tenant override lives in tenants.settings.returnWindowMs.
const RETURN_WINDOW_MS = DEFAULT_RETURN_WINDOW_MS;

function fireInvoiceSync(tenantId: string, userId: string, effectiveDate?: string): void {
  try {
    const specifier = '../invoices/invoice.service.js';
    const pending: Promise<unknown> = import(specifier);
    void pending
      .then((m) => {
        const mod = m as {
          syncInvoiceStatusAfterPayment?: (tenantId: string, userId: string, effectiveDate?: string) => unknown;
        };
        try {
          mod.syncInvoiceStatusAfterPayment?.(tenantId, userId, effectiveDate);
        } catch {
          // invoice sync must never break the main flow
        }
      })
      .catch(() => undefined);
  } catch {
    // invoices module may not exist yet
  }
}

export async function requestReturn(tenantId: string, userId: string, input: CreateReturnInput, tx?: DrizzleTx) {
  const run = async (t: DrizzleTx) => {
    const order = await findOrderById(tenantId, input.orderId, t);
    if (!order || order.userId !== userId) throw new AppError('Order not found', 404);
    if (order.orderStatus !== 'delivered' || !order.deliveredAt) {
      throw new AppError('Only delivered orders can be returned', 409);
    }
    // Normalize both sides to UTC epoch millis before comparing so an
    // IST-offset deliveredAt string is measured on the same clock as Date.now().
    // deliveredAt is stored as timestamptz (UTC) — see schema default.
    const deliveredUtc = new Date(order.deliveredAt).getTime();
    if (Number.isNaN(deliveredUtc)) {
      throw new AppError('Order delivery timestamp is invalid', 500);
    }
    const { returnWindowMs } = await getTenantSettings(tenantId, t);
    const windowMs = returnWindowMs || RETURN_WINDOW_MS;
    if (Date.now() - deliveredUtc > windowMs) {
      throw new AppError('Return window expired (24 hours after delivery)', 409);
    }
    const existing = await findActiveReturnForOrder(tenantId, input.orderId, t);
    if (existing) throw new AppError('Return already requested for this order', 409);

    const orderItemRows = await findOrderItemsByOrderId(input.orderId, t);
    if (orderItemRows.length === 0) throw new AppError('Order has no items to return', 400);
    const byId = new Map(orderItemRows.map((i) => [i.id, i]));
    for (const item of input.items) {
      const orderItem = byId.get(item.orderItemId);
      if (!orderItem) throw new AppError('Order item not found in this order', 404);
      if (item.quantity > Number(orderItem.quantity)) {
        throw new AppError(`Return quantity exceeds ordered quantity for ${orderItem.productName}`, 400);
      }
    }

    const ret = await insertReturn(tenantId, { orderId: input.orderId, userId, reason: input.reason }, t);
    const items = await insertReturnItems(
      ret.id,
      input.items.map((item) => {
        const orderItem = byId.get(item.orderItemId)!;
        return {
          orderItemId: item.orderItemId,
          quantity: String(item.quantity),
          unitPrice: String(orderItem.unitPrice),
          productName: orderItem.productName,
          variantLabel: orderItem.variantLabel,
        };
      }),
      t,
    );
    return { ...ret, items };
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function myReturns(tenantId: string, userId: string, query: ReturnListQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listReturnsByUser(
    tenantId,
    userId,
    { limit, offset, status: query.status },
    dbOrTx,
  );
  return { rows, meta: buildMeta(total, page, limit) };
}

export async function listAdmin(tenantId: string, query: ReturnListQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listAllReturns(tenantId, { limit, offset, status: query.status }, dbOrTx);
  return { rows, meta: buildMeta(total, page, limit) };
}

export async function updateStatus(
  tenantId: string,
  returnId: string,
  adminId: string,
  input: UpdateReturnStatusInput,
  tx?: DrizzleTx,
) {
  const { status, adminNotes, refundAmount } = input;
  const needsRefund = status === 'approved' || status === 'completed';
  if (needsRefund && (refundAmount === undefined || refundAmount <= 0)) {
    throw new AppError('refundAmount is required and must be greater than 0', 400);
  }
  let syncUserId: string | null = null;
  let syncDate: string | undefined;
  const run = async (t: DrizzleTx) => {
    const ret = await findReturnById(tenantId, returnId, t);
    if (!ret) throw new AppError('Return not found', 404);
    const order = await findOrderById(tenantId, ret.orderId, t);
    if (!order) throw new AppError('Order not found', 404);

    // Rejecting a return voids any previously created return_refund so the
    // customer ledger never keeps money for a denied return.
    if (status === 'rejected') {
      await transactionService.voidTransactionByRef(
        returnId,
        'return',
        tenantId,
        'Return rejected — refund voided',
        adminId,
        t,
      );
    }

    let refundTransaction: unknown = null;
    if (needsRefund && refundAmount !== undefined) {
      const effectiveDate = toDateOnlyString(istToday());
      refundTransaction = await transactionService.createTransaction(
        {
          tenantId,
          partyType: 'customer',
          partyId: order.userId,
          txnType: 'return_refund',
          entryType: 'credit',
          amount: refundAmount,
          effectiveDate,
          referenceType: 'return',
          referenceId: ret.id,
          description: `Refund for return ${ret.id} (order ${order.id})`,
          createdById: adminId,
        },
        t,
      );
      syncUserId = order.userId;
      syncDate = effectiveDate;
    }

    const updated = await updateReturnRow(
      tenantId,
      returnId,
      { status, adminNotes: adminNotes ?? null, resolvedAt: new Date(), resolvedById: adminId },
      t,
    );
    if (!updated) throw new AppError('Return not found', 404);
    const items = await findReturnItemsByReturnId(returnId, t);
    return { ...updated, items, refundTransaction };
  };
  const result = tx ? await run(tx) : await withTransaction(run);
  if (syncUserId) fireInvoiceSync(tenantId, syncUserId, syncDate);
  return result;
}
