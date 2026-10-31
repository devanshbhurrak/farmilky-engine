import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import {
  recordDeliveryOutcome,
  correctDelivery,
  rescheduleDelivery,
  cancelDelivery,
  recordPaymentAgainstDelivery,
  markMissedDeliveries,
  getCustomerDeliverySummary,
  listUnconfirmedDeliveries,
  confirmUnconfirmedDeliveries,
  isEveningOpen,
} from './delivery.service.js';
import { listDeliveries, findDeliveryWithItems } from './delivery.repository.js';
import type {
  RecordDeliveryOutcomeInput,
  RescheduleDeliveryInput,
  CancelDeliveryInput,
  DeliveryQuery,
  DeliveryIdParam,
  SessionStateQuery,
} from './delivery.schema.js';
import { toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { istToday } from '../../shared/utils/dateUtils.js';
import type { CustomerDeliverySummaryInput } from './delivery.schema.js';

const isAdmin = (user: AuthUser) => user.role === 'admin';

export const recordDeliveryOutcomeController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as RecordDeliveryOutcomeInput;
  const result = await recordDeliveryOutcome(
    user.tenantId,
    {
      customerId: body.customerId,
      type: body.type,
      referenceType: body.referenceType ?? null,
      referenceId: body.referenceId ?? null,
      deliveryDate: body.deliveryDate,
      deliverySlot: body.deliverySlot ?? null,
      status: body.status,
      scheduledQuantity: body.scheduledQuantity,
      actualQuantity: body.actualQuantity,
      pricePerPacket: body.pricePerPacket,
      items: body.items,
      paymentMode: body.paymentMode ?? null,
      reason: body.reason ?? null,
      notes: body.notes ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
      expectedVersion: body.expectedVersion,
    },
    user.id,
  );
  return created(c, result);
};

export const correctDeliveryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as DeliveryIdParam;
  const body = c.get('body') as {
    status?: RecordDeliveryOutcomeInput['status'];
    actualQuantity?: number;
    scheduledQuantity?: number;
    pricePerPacket?: number;
    reason?: string | null;
    notes?: string | null;
    expectedVersion: number;
  };
  if (body.expectedVersion == null) {
    return c.json({ success: false, message: 'expectedVersion is required for corrections' }, 422);
  }
  const result = await correctDelivery(
    user.tenantId,
    params.id,
    {
      status: body.status,
      actualQuantity: body.actualQuantity,
      scheduledQuantity: body.scheduledQuantity,
      pricePerPacket: body.pricePerPacket,
      reason: body.reason ?? null,
      notes: body.notes ?? null,
    },
    user.id,
    body.expectedVersion,
  );
  return ok(c, result);
};

export const rescheduleDeliveryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as DeliveryIdParam;
  const body = c.get('body') as RescheduleDeliveryInput;
  const result = await rescheduleDelivery(
    user.tenantId,
    params.id,
    {
      newDeliveryDate: body.newDeliveryDate,
      newDeliverySlot: body.newDeliverySlot ?? null,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey ?? null,
    },
    user.id,
  );
  return ok(c, result);
};

export const cancelDeliveryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as DeliveryIdParam;
  const body = c.get('body') as CancelDeliveryInput;
  const result = await cancelDelivery(user.tenantId, params.id, body, user.id);
  return ok(c, result);
};

export const recordPaymentController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as DeliveryIdParam;
  const body = c.get('body') as {
    amount: number;
    paymentMethod: string;
    paymentRef?: string | null;
    receivedDate?: string | null;
    description?: string | null;
    notes?: string | null;
  };
  const result = await recordPaymentAgainstDelivery(
    user.tenantId,
    params.id,
    {
      amount: body.amount,
      paymentMethod: body.paymentMethod,
      paymentRef: body.paymentRef ?? null,
      receivedDate: body.receivedDate ?? null,
      description: body.description ?? null,
      notes: body.notes ?? null,
    },
    user.id,
  );
  return ok(c, result);
};

export const getDeliveryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as DeliveryIdParam;
  const detail = await findDeliveryWithItems(user.tenantId, params.id);
  if (!detail) throw new AppError('Delivery not found', 404);
  return ok(c, detail);
};

export const listDeliveriesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as DeliveryQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listDeliveries(user.tenantId, {
    customerId: query.customerId ?? null,
    type: query.type ?? null,
    status: query.status ?? null,
    paymentStatus: query.paymentStatus ?? null,
    date: query.date ?? null,
    fromDate: query.fromDate ?? null,
    toDate: query.toDate ?? null,
    slot: query.slot ?? null,
    search: query.search ?? null,
  }, {
    limit,
    offset,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const customerDeliverySummaryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as CustomerDeliverySummaryInput & { customerId?: string };
  const customerId = query.customerId ?? user.id;
  // Non-admins can only read their own summary.
  if (!isAdmin(user) && customerId !== user.id) {
    return c.json({ success: false, message: 'Forbidden' }, 403);
  }
  const summary = await getCustomerDeliverySummary(user.tenantId, {
    customerId,
    fromDate: query.fromDate ?? null,
    toDate: query.toDate ?? null,
  });
  return ok(c, summary);
};

export const markMissedDeliveriesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  if (!isAdmin(user)) return c.json({ success: false, message: 'Forbidden' }, 403);
  const body = (c.get('body') ?? {}) as { beforeDate?: string | null };
  const cutoff = body.beforeDate ?? new Date().toISOString().slice(0, 10);
  const marked = await markMissedDeliveries(user.tenantId, cutoff);
  return ok(c, { marked: marked.length, items: marked });
};

export const unconfirmedDeliveriesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as { days?: number; slot?: 'morning' | 'evening' };
  const result = await listUnconfirmedDeliveries(user.tenantId, {
    days: query.days,
    slot: query.slot,
  });
  return ok(c, result);
};

export const confirmUnconfirmedDeliveriesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = (c.get('body') ?? {}) as { days?: number; slot?: 'morning' | 'evening' };
  const result = await confirmUnconfirmedDeliveries(
    user.tenantId,
    { days: body.days, slot: body.slot },
    user.id,
  );
  return ok(c, result);
};

export const getSessionStateController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as SessionStateQuery;
  const date = query.date ?? toDateOnlyString(istToday());
  const isToday = date === toDateOnlyString(istToday());
  return ok(c, {
    date,
    isToday,
    morningOpen: true,
    eveningOpen: isEveningOpen(date),
    eveningOpensAt: '17:00 IST',
  });
};
