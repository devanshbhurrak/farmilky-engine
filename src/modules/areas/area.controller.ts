import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  AreaCustomersQuery,
  AreaIdParam,
  AreaListQuery,
  AssignCustomersInput,
  CreateAreaInput,
  UpdateAreaInput,
} from './area.schema.js';
import {
  createAreaService,
  deleteAreaService,
  getAreaService,
  listAgentsService,
  listAreaCustomersService,
  listAreasService,
  updateAreaCustomersService,
  updateAreaService,
} from './area.service.js';

export const listAreasController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as AreaListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listAreasService(user.tenantId, { page, limit, offset });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const getAreaController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AreaIdParam;
  const area = await getAreaService(user.tenantId, params.id);
  return ok(c, area);
};

export const createAreaController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateAreaInput;
  const area = await createAreaService(user.tenantId, body);
  return created(c, area);
};

export const updateAreaController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AreaIdParam;
  const body = c.get('body') as UpdateAreaInput;
  const area = await updateAreaService(user.tenantId, params.id, body);
  return ok(c, area);
};

export const deleteAreaController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AreaIdParam;
  const result = await deleteAreaService(user.tenantId, params.id);
  return ok(c, result);
};

export const listAgentsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as AreaListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listAgentsService(user.tenantId, { page, limit, offset });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const listAreaCustomersController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AreaIdParam;
  const query = (c.get('query') ?? {}) as AreaCustomersQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listAreaCustomersService(user.tenantId, params.id, {
    page,
    limit,
    offset,
  });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const updateAreaCustomersController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as AreaIdParam;
  const body = c.get('body') as AssignCustomersInput;
  const result = await updateAreaCustomersService(user.tenantId, params.id, body);
  return ok(c, result);
};
