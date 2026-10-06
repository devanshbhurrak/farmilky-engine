import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  AdminCreateOrderInput,
  AdminOrderListQuery,
  CancelInput,
  DeliveryOutcomeInput,
  InstantDeliveryInput,
  OrderIdParam,
  OrderListQuery,
  OrderStatusInput,
  PlaceOrderInput,
  UpdateOrderInput,
} from './order.schema.js';
import {
  cancelOrder,
  createAdminOrder,
  createInstantDelivery,
  createOrderFromCart,
  getOrderAdmin,
  getOrderForRequester,
  listAdminOrders,
  listUserOrders,
  recordDeliveryOutcome,
  updateOrderAdmin,
} from './order.service.js';

export const placeOrderController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as PlaceOrderInput;
  const result = await createOrderFromCart(user.tenantId, user.id, body);
  return created(c, result);
};

export const listMyOrdersController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as OrderListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listUserOrders(user.tenantId, user.id, {
    limit,
    offset,
    status: query.status,
  });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const getOrderController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as OrderIdParam;
  const result = await getOrderForRequester(user.tenantId, user.id, params.id, user.role === 'admin');
  return ok(c, result);
};

export const cancelOrderController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as OrderIdParam;
  const body = (c.get('body') ?? {}) as CancelInput;
  const order = await cancelOrder(user.tenantId, params.id, user.id, user.role === 'admin', body.reason);
  return ok(c, order);
};

export const adminCreateOrderController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as AdminCreateOrderInput;
  const result = await createAdminOrder(user.tenantId, user.id, body);
  return created(c, result);
};

export const instantDeliveryController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as InstantDeliveryInput;
  const result = await createInstantDelivery(user.tenantId, user.id, body);
  return created(c, result);
};

export const adminListOrdersController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as AdminOrderListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listAdminOrders(user.tenantId, {
    limit,
    offset,
    status: query.status,
    search: query.search,
  });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const adminGetOrderController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as OrderIdParam;
  const result = await getOrderAdmin(user.tenantId, params.id);
  return ok(c, result);
};

export const adminUpdateOrderController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as OrderIdParam;
  const body = c.get('body') as UpdateOrderInput;
  const order = await updateOrderAdmin(user.tenantId, params.id, body, user.id);
  return ok(c, order);
};

export const updateOrderStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as OrderIdParam;
  const body = c.get('body') as OrderStatusInput;
  const order = await updateOrderAdmin(user.tenantId, params.id, { status: body.status }, user.id);
  return ok(c, order);
};

export const deliveryOutcomeController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as OrderIdParam;
  const body = c.get('body') as DeliveryOutcomeInput;
  const result = await recordDeliveryOutcome(user.tenantId, params.id, body, user.id);
  return ok(c, result);
};
