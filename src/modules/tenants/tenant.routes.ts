import { Hono } from 'hono';
import type { HonoEnv } from '../../shared/types/index.js';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody } from '../../shared/middleware/validate.js';
import { getMe, registerTenant, updateMe } from './tenant.controller.js';
import { registerTenantSchema, updateTenantSchema } from './tenant.schema.js';

export const tenantRoutes = new Hono<HonoEnv>();

tenantRoutes.post('/register', validateBody(registerTenantSchema), registerTenant);
tenantRoutes.get('/me', auth, tenant, adminOnly, getMe);
tenantRoutes.put('/me', auth, tenant, adminOnly, validateBody(updateTenantSchema), updateMe);
