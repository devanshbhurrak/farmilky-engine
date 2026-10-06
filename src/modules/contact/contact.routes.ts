import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  createContactController,
  listContactMessagesController,
  updateContactStatusController,
} from './contact.controller.js';
import {
  contactAdminListQuerySchema,
  contactIdParamSchema,
  createContactSchema,
  updateStatusSchema,
} from './contact.schema.js';

export const contactRoutes = new Hono<HonoEnv>();

contactRoutes.post('/', validateBody(createContactSchema), createContactController);

contactRoutes.get(
  '/admin/all',
  auth,
  tenant,
  adminOnly,
  validateQuery(contactAdminListQuerySchema),
  listContactMessagesController,
);
contactRoutes.patch(
  '/admin/:id/status',
  auth,
  tenant,
  adminOnly,
  validateParams(contactIdParamSchema),
  validateBody(updateStatusSchema),
  updateContactStatusController,
);
