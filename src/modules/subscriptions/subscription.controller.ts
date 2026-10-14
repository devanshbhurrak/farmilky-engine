import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import {
  adminCreateSubscription,
  adminUpdateSubscription,
  adminUpdateSubscriptionStatus,
  bulkPauseSubscriptions,
  bulkResumeSubscriptions,
  cancelScheduledChange,
  cancelSubscription,
  cancelVacation,
  createSubscription,
  deleteDeliveryHistoryEntry,
  getDeliveryBoard,
  getSubscriptionById,
  getTodaySupply,
  listActiveSubscriptionsForUser,
  listMySubscriptions,
  listSubscriptionsAdminService,
  markDeliveredToday,
  pauseSubscription,
  recordAgentDeliveryOutcome,
  recordDeliveryOutcome,
  resumeSubscription,
  scheduleSubscriptionChange,
  setVacation,
  skipDeliveryDate,
  unskipDeliveryDate,
  updateSubscriptionSchedule,
} from './subscription.service.js';
import type {
  AdminCreateSubscriptionInput,
  AdminSubscriptionListQuery,
  AdminUpdateSubscriptionInput,
  AgentDeliveryOutcomeInput,
  BulkIdsInput,
  CreateSubscriptionInput,
  DeliveryBoardQuery,
  DeliveryEntryParam,
  DeliveryOutcomeInput,
  HistoryQuery,
  PauseSubscriptionInput,
  ScheduleChangeInput,
  SkipSubscriptionInput,
  StatusUpdateInput,
  SubscriptionIdParam,
  SubscriptionUserParam,
  UpdateSubscriptionInput,
  VacationSubscriptionInput,
} from './subscription.schema.js';

const isAdmin = (user: AuthUser) => user.role === 'admin';

export const createSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateSubscriptionInput;
  const sub = await createSubscription(user.tenantId, user.id, body, null);
  return created(c, sub);
};

export const adminCreateSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as AdminCreateSubscriptionInput;
  const sub = await adminCreateSubscription(user.tenantId, body, user.id);
  return created(c, sub);
};

export const listMySubscriptionsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const items = await listMySubscriptions(user.tenantId, user.id);
  return ok(c, items);
};

export const getSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const sub = await getSubscriptionById(user.tenantId, params.id, {
    id: user.id,
    isAdmin: isAdmin(user),
  });
  return ok(c, sub);
};

export const getSubscriptionHistoryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const query = (c.get('query') ?? {}) as HistoryQuery;
  const { page, limit, offset } = parsePagination(query);

  // Verify subscription exists and user has access
  await getSubscriptionById(user.tenantId, params.id, {
    id: user.id,
    isAdmin: isAdmin(user),
  });

  // Get all deliveries for the subscription
  const deliveries = await Promise.resolve(
    (await import('./subscription.repository.js')).listDeliveriesBySubscription(
      user.tenantId,
      params.id,
    ),
  );

  // Filter by month/year if provided
  const month = query.month ? Number(query.month) : undefined;
  const year = query.year ? Number(query.year) : undefined;
  const filtered = deliveries.filter((d) => {
    if (!month && !year) return true;
    const date = new Date(d.deliveryDate as string);
    if (year && date.getFullYear() !== year) return false;
    if (month && date.getMonth() + 1 !== month) return false;
    return true;
  });

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  return paginated(c, items, buildMeta(total, page, limit));
};

export const updateSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as UpdateSubscriptionInput;
  const sub = await updateSubscriptionSchedule(user.tenantId, params.id, user.id, body, isAdmin(user));
  return ok(c, sub);
};

export const pauseSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = (c.get('body') ?? {}) as PauseSubscriptionInput;
  const sub = await pauseSubscription(user.tenantId, params.id, body.reason, user.id);
  return ok(c, sub);
};

export const resumeSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const sub = await resumeSubscription(user.tenantId, params.id, user.id);
  return ok(c, sub);
};

export const cancelSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const sub = await cancelSubscription(user.tenantId, params.id, user.id);
  return ok(c, sub);
};

export const skipSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as SkipSubscriptionInput;
  const sub = await skipDeliveryDate(user.tenantId, params.id, body.date, user.id);
  return ok(c, sub);
};

export const unskipSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as SkipSubscriptionInput;
  const sub = await unskipDeliveryDate(user.tenantId, params.id, body.date, user.id);
  return ok(c, sub);
};

export const setVacationController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as VacationSubscriptionInput;
  const sub = await setVacation(user.tenantId, params.id, body, user.id);
  return ok(c, sub);
};

export const cancelVacationController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const sub = await cancelVacation(user.tenantId, params.id, user.id);
  return ok(c, sub);
};

export const adminListSubscriptionsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as AdminSubscriptionListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listSubscriptionsAdminService(
    user.tenantId,
    { status: query.status, search: query.search },
    { page, limit, offset },
  );
  return paginated(c, items, buildMeta(total, page, limit));
};

export const todaySupplyController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as DeliveryBoardQuery;
  const supply = await getTodaySupply(user.tenantId, { date: query.date, slot: query.slot });
  return ok(c, supply);
};

export const deliveryBoardController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as DeliveryBoardQuery;
  const { listPendingForDateSlot } = await import('../orders/order.service.js');
  const { toDateOnlyString: toDateOnly, istToday: istTodayFn } = await import(
    '../../shared/utils/dateUtils.js'
  );
  const date = query.date ?? toDateOnly(istTodayFn());
  const orders = await listPendingForDateSlot(user.tenantId, date, query.slot ?? undefined);
  const board = await getDeliveryBoard(user.tenantId, { date: query.date, slot: query.slot }, orders);
  return ok(c, board);
};

export const activeForUserController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionUserParam;
  const items = await listActiveSubscriptionsForUser(user.tenantId, params.userId);
  return ok(c, items);
};

export const adminUpdateSubscriptionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as AdminUpdateSubscriptionInput;
  const sub = await adminUpdateSubscription(user.tenantId, params.id, body, user.id);
  return ok(c, sub);
};

export const adminUpdateStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as StatusUpdateInput;
  const sub = await adminUpdateSubscriptionStatus(user.tenantId, params.id, body.status, user.id);
  return ok(c, sub);
};

export const scheduleChangeController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as ScheduleChangeInput;
  const sub = await scheduleSubscriptionChange(user.tenantId, params.id, body, user.id);
  return ok(c, sub);
};

export const cancelScheduleChangeController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const sub = await cancelScheduledChange(user.tenantId, params.id, user.id);
  return ok(c, sub);
};

export const recordDeliveryOutcomeController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as DeliveryOutcomeInput;
  const result = await recordDeliveryOutcome(params.id, user.tenantId, body, user.id);
  return created(c, result);
};

export const agentDeliveryOutcomeController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const body = c.get('body') as AgentDeliveryOutcomeInput;
  const result = await recordAgentDeliveryOutcome(params.id, user.tenantId, body, user.id);
  return created(c, result);
};

export const markDeliveredController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as SubscriptionIdParam;
  const result = await markDeliveredToday(params.id, user.tenantId, user.id);
  return created(c, result);
};

export const deleteDeliveryEntryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as DeliveryEntryParam;
  const result = await deleteDeliveryHistoryEntry(params.id, params.entryId, user.tenantId, user.id);
  return ok(c, result);
};

export const bulkPauseController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as BulkIdsInput;
  const result = await bulkPauseSubscriptions(user.tenantId, body.subscriptionIds, user.id);
  return ok(c, result);
};

export const bulkResumeController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as BulkIdsInput;
  const result = await bulkResumeSubscriptions(user.tenantId, body.subscriptionIds, user.id);
  return ok(c, result);
};
