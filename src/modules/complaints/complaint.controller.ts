import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  ComplaintIdParam,
  ComplaintListQuery,
  CreateComplaintInput,
  UpdateComplaintStatusInput,
} from './complaint.schema.js';
import { create, getById, listAdmin, listMine, updateStatus } from './complaint.service.js';

export const createComplaintController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateComplaintInput;
  const complaint = await create(user.tenantId, user.id, body);
  return created(c, complaint);
};

export const listMyComplaintsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ComplaintListQuery;
  const { rows, meta } = await listMine(user.tenantId, user.id, query);
  return paginated(c, rows, meta);
};

export const getComplaintController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ComplaintIdParam;
  const complaint = await getById(user.tenantId, params.id, user.id, user.role === 'admin');
  return ok(c, complaint);
};

export const adminListComplaintsController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ComplaintListQuery;
  const { rows, meta } = await listAdmin(user.tenantId, query);
  return paginated(c, rows, meta);
};

export const updateComplaintStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ComplaintIdParam;
  const body = c.get('body') as UpdateComplaintStatusInput;
  const updated = await updateStatus(user.tenantId, params.id, user.id, body);
  return ok(c, updated);
};
