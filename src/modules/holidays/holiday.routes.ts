import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  createHolidayController,
  deleteHolidayController,
  listHolidaysController,
  updateHolidayController,
} from './holiday.controller.js';
import {
  createHolidaySchema,
  holidayIdParamSchema,
  holidayListQuerySchema,
  updateHolidaySchema,
} from './holiday.schema.js';

export const holidayRoutes = new Hono<HonoEnv>();

holidayRoutes.get(
  '/',
  auth,
  tenant,
  adminOnly,
  validateQuery(holidayListQuerySchema),
  listHolidaysController,
);
holidayRoutes.post(
  '/',
  auth,
  tenant,
  adminOnly,
  validateBody(createHolidaySchema),
  createHolidayController,
);
holidayRoutes.put(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(holidayIdParamSchema),
  validateBody(updateHolidaySchema),
  updateHolidayController,
);
holidayRoutes.delete(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(holidayIdParamSchema),
  deleteHolidayController,
);
