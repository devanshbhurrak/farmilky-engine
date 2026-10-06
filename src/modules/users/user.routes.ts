import { Hono } from 'hono';
import type { HonoEnv } from '../../shared/types/index.js';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import {
  createAdminUser,
  getAdminUser,
  getProfile,
  listAdminUsers,
  login,
  logout,
  refresh,
  register,
  updateAdminUser,
  updateDeliveryConfig,
  updateProfile,
} from './user.controller.js';
import {
  adminCreateUserSchema,
  adminListQuerySchema,
  adminUpdateUserSchema,
  customerRegisterSchema,
  deliveryConfigSchema,
  loginSchema,
  refreshBodySchema,
  updateProfileSchema,
  userIdParamSchema,
} from './user.schema.js';

export const userRoutes = new Hono<HonoEnv>();

userRoutes.post('/register', validateBody(customerRegisterSchema), register);
userRoutes.post('/login', validateBody(loginSchema), login);
userRoutes.post('/logout', auth, logout);
userRoutes.post('/refresh', validateBody(refreshBodySchema), refresh);

userRoutes.get('/profile', auth, tenant, getProfile);
userRoutes.put('/profile', auth, tenant, validateBody(updateProfileSchema), updateProfile);

userRoutes.get('/admin/all', auth, tenant, adminOnly, validateQuery(adminListQuerySchema), listAdminUsers);
userRoutes.post(
  '/admin/create',
  auth,
  tenant,
  adminOnly,
  validateBody(adminCreateUserSchema),
  createAdminUser,
);
userRoutes.get('/admin/:id', auth, tenant, adminOnly, validateParams(userIdParamSchema), getAdminUser);
userRoutes.put(
  '/admin/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(userIdParamSchema),
  validateBody(adminUpdateUserSchema),
  updateAdminUser,
);
userRoutes.put(
  '/admin/:id/delivery-config',
  auth,
  tenant,
  adminOnly,
  validateParams(userIdParamSchema),
  validateBody(deliveryConfigSchema),
  updateDeliveryConfig,
);
