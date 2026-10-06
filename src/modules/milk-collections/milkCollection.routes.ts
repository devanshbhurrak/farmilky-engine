import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  bulkConfirmController,
  confirmController,
  dailyController,
  generateController,
  historyController,
  missingController,
  todayShiftController,
  updateCollectionController,
} from './milkCollection.controller.js';
import {
  bulkConfirmSchema,
  collectionIdParamSchema,
  confirmSchema,
  dailyQuerySchema,
  generateSchema,
  historyQuerySchema,
  missingQuerySchema,
  updateCollectionSchema,
} from './milkCollection.schema.js';

export const milkCollectionRoutes = new Hono<HonoEnv>();

milkCollectionRoutes.post('/generate', auth, tenant, adminOnly, validateBody(generateSchema), generateController);
milkCollectionRoutes.get('/daily', auth, tenant, adminOnly, validateQuery(dailyQuerySchema), dailyController);
milkCollectionRoutes.post(
  '/bulk-confirm',
  auth,
  tenant,
  adminOnly,
  validateBody(bulkConfirmSchema),
  bulkConfirmController,
);
milkCollectionRoutes.get('/today-shift', auth, tenant, adminOnly, todayShiftController);
milkCollectionRoutes.get(
  '/missing',
  auth,
  tenant,
  adminOnly,
  validateQuery(missingQuerySchema),
  missingController,
);
milkCollectionRoutes.get('/', auth, tenant, adminOnly, validateQuery(historyQuerySchema), historyController);
milkCollectionRoutes.post(
  '/:id/confirm',
  auth,
  tenant,
  adminOnly,
  validateParams(collectionIdParamSchema),
  validateBody(confirmSchema),
  confirmController,
);
milkCollectionRoutes.put(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(collectionIdParamSchema),
  validateBody(updateCollectionSchema),
  updateCollectionController,
);
