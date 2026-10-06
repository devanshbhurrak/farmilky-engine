import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { ok } from '../../shared/utils/response.js';
import {
  getAdminStats,
  getDeliveryPerformance,
  getDeliveryStats,
  getProfitStats,
} from './admin.service.js';
import type { DeliveryPerformanceQuery } from './admin.schema.js';

export const adminStatsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const stats = await getAdminStats(user.tenantId);
  return ok(c, stats);
};

export const deliveryStatsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const stats = await getDeliveryStats(user.tenantId);
  return ok(c, stats);
};

export const deliveryPerformanceController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as DeliveryPerformanceQuery;
  const stats = await getDeliveryPerformance(user.tenantId, query.days ?? 7);
  return ok(c, stats);
};

export const profitStatsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const stats = await getProfitStats(user.tenantId);
  return ok(c, stats);
};
