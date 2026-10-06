import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  CreateReturnInput,
  ReturnIdParam,
  ReturnListQuery,
  UpdateReturnStatusInput,
} from './return.schema.js';
import { listAdmin, myReturns, requestReturn, updateStatus } from './return.service.js';

export const createReturnController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateReturnInput;
  const ret = await requestReturn(user.tenantId, user.id, body);
  return created(c, ret);
};

export const myReturnsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ReturnListQuery;
  const { rows, meta } = await myReturns(user.tenantId, user.id, query);
  return paginated(c, rows, meta);
};

export const adminListReturnsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ReturnListQuery;
  const { rows, meta } = await listAdmin(user.tenantId, query);
  return paginated(c, rows, meta);
};

export const updateReturnStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ReturnIdParam;
  const body = c.get('body') as UpdateReturnStatusInput;
  const updated = await updateStatus(user.tenantId, params.id, user.id, body);
  return ok(c, updated);
};
