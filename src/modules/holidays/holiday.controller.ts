import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { created, ok } from '../../shared/utils/response.js';
import type {
  CreateHolidayInput,
  HolidayIdParam,
  HolidayListQuery,
  UpdateHolidayInput,
} from './holiday.schema.js';
import {
  createHolidayService,
  deleteHolidayService,
  listHolidaysService,
  updateHolidayService,
} from './holiday.service.js';

export const listHolidaysController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as HolidayListQuery;
  const items = await listHolidaysService(user.tenantId, { year: query.year });
  return ok(c, items);
};

export const createHolidayController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as CreateHolidayInput;
  const holiday = await createHolidayService(user.tenantId, body);
  return created(c, holiday);
};

export const updateHolidayController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as HolidayIdParam;
  const body = c.get('body') as UpdateHolidayInput;
  const holiday = await updateHolidayService(user.tenantId, params.id, body);
  return ok(c, holiday);
};

export const deleteHolidayController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as HolidayIdParam;
  const result = await deleteHolidayService(user.tenantId, params.id);
  return ok(c, result);
};
