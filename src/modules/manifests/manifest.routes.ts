import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { deliveryOrAdmin } from '../../shared/middleware/deliveryOrAdmin.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  generateManifestsController,
  getManifestController,
  listManifestsController,
  myHistoryController,
  myTodayManifestController,
  resequenceManifestController,
  updateManifestEntryController,
} from './manifest.controller.js';
import {
  generateSchema,
  manifestEntryParamSchema,
  manifestHistoryQuerySchema,
  manifestIdParamSchema,
  manifestQuerySchema,
  resequenceSchema,
  updateEntrySchema,
} from './manifest.schema.js';

export const manifestRoutes = new Hono<HonoEnv>();

manifestRoutes.post(
  '/generate',
  auth,
  tenant,
  adminOnly,
  validateBody(generateSchema),
  generateManifestsController,
);
manifestRoutes.get(
  '/',
  auth,
  tenant,
  adminOnly,
  validateQuery(manifestQuerySchema),
  listManifestsController,
);

// /my/* routes must be defined BEFORE /:id so "my" isn't captured as an id.
manifestRoutes.get('/my/today', auth, tenant, deliveryOrAdmin, myTodayManifestController);
manifestRoutes.get(
  '/my/history',
  auth,
  tenant,
  deliveryOrAdmin,
  validateQuery(manifestHistoryQuerySchema),
  myHistoryController,
);

manifestRoutes.get(
  '/:id',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(manifestIdParamSchema),
  getManifestController,
);
manifestRoutes.put(
  '/:id/resequence',
  auth,
  tenant,
  adminOnly,
  validateParams(manifestIdParamSchema),
  validateBody(resequenceSchema),
  resequenceManifestController,
);
manifestRoutes.put(
  '/:id/entries/:entryId',
  auth,
  tenant,
  deliveryOrAdmin,
  validateParams(manifestEntryParamSchema),
  validateBody(updateEntrySchema),
  updateManifestEntryController,
);
