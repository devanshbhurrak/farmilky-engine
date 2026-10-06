import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  BulkConfirmInput,
  CollectionIdParam,
  ConfirmInput,
  DailyQuery,
  GenerateInput,
  HistoryQuery,
  MissingQuery,
  UpdateCollectionInput,
} from './milkCollection.schema.js';
import {
  bulkConfirmCollections,
  confirmCollection,
  generateCollections,
  getCollectionHistory,
  getDailyCollections,
  getMissingCollections,
  getTodayShift,
  updateCollection,
} from './milkCollection.service.js';

export const generateController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = (c.get('body') ?? {}) as GenerateInput;
  const date = body.date ?? toDateOnlyString(istToday());
  const result = await generateCollections(user.tenantId, date, user.id);
  return created(c, result);
};

export const dailyController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as DailyQuery;
  const date = query.date ?? toDateOnlyString(istToday());
  const result = await getDailyCollections(user.tenantId, date);
  return ok(c, result);
};

export const confirmController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as CollectionIdParam;
  const body = c.get('body') as ConfirmInput;
  const result = await confirmCollection(user.tenantId, params.id, body, user.id);
  return ok(c, result);
};

export const bulkConfirmController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as BulkConfirmInput;
  const result = await bulkConfirmCollections(user.tenantId, body, user.id);
  return ok(c, result);
};

export const historyController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as HistoryQuery;
  const { rows, meta, aggregates } = await getCollectionHistory(user.tenantId, query);
  return paginated(c, { collections: rows, aggregates }, meta);
};

export const updateCollectionController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as CollectionIdParam;
  const body = c.get('body') as UpdateCollectionInput;
  const result = await updateCollection(user.tenantId, params.id, body, user.id);
  return ok(c, result);
};

export const todayShiftController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const result = await getTodayShift(user.tenantId);
  return ok(c, result);
};

export const missingController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as MissingQuery;
  const result = await getMissingCollections(user.tenantId, query);
  return ok(c, result);
};
