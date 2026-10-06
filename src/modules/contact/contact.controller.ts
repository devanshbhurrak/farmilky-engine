import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type {
  ContactAdminListQuery,
  ContactIdParam,
  CreateContactInput,
  UpdateContactStatusInput,
} from './contact.schema.js';
import {
  createContactMessage,
  listContactMessagesService,
  updateContactStatusService,
} from './contact.service.js';

export const createContactController = async (c: Context) => {
  const body = c.get('body') as CreateContactInput;
  const headerSlug = c.req.header('x-tenant-slug');
  const message = await createContactMessage(body, headerSlug);
  return created(c, message);
};

export const listContactMessagesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as ContactAdminListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { items, total } = await listContactMessagesService(user.tenantId, {
    status: query.status,
    page,
    limit,
    offset,
  });
  return paginated(c, items, buildMeta(total, page, limit));
};

export const updateContactStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as ContactIdParam;
  const body = c.get('body') as UpdateContactStatusInput;
  const message = await updateContactStatusService(user.tenantId, params.id, body.status);
  return ok(c, message);
};
