import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  createAdjustmentController,
  createSupplierController,
  deleteAdjustmentController,
  deleteSupplierController,
  getSupplierController,
  getSupplierPassbookController,
  listSuppliersController,
  setSupplierStatusController,
  updateSupplierController,
} from './supplier.controller.js';
import {
  adjustmentSchema,
  createSupplierSchema,
  deleteAdjustmentSchema,
  statusSchema,
  supplierAdjustmentParamSchema,
  supplierIdParamSchema,
  supplierListQuerySchema,
  supplierPassbookQuerySchema,
  updateSupplierSchema,
} from './supplier.schema.js';

export const supplierRoutes = new Hono<HonoEnv>();

supplierRoutes.get('/', auth, tenant, adminOnly, validateQuery(supplierListQuerySchema), listSuppliersController);
supplierRoutes.post('/', auth, tenant, adminOnly, validateBody(createSupplierSchema), createSupplierController);
supplierRoutes.get(
  '/:id/passbook',
  auth,
  tenant,
  adminOnly,
  validateParams(supplierIdParamSchema),
  validateQuery(supplierPassbookQuerySchema),
  getSupplierPassbookController,
);
supplierRoutes.post(
  '/:id/adjustments',
  auth,
  tenant,
  adminOnly,
  validateParams(supplierIdParamSchema),
  validateBody(adjustmentSchema),
  createAdjustmentController,
);
supplierRoutes.delete(
  '/:id/adjustments/:adjId',
  auth,
  tenant,
  adminOnly,
  validateParams(supplierAdjustmentParamSchema),
  validateBody(deleteAdjustmentSchema),
  deleteAdjustmentController,
);
supplierRoutes.patch(
  '/:id/status',
  auth,
  tenant,
  adminOnly,
  validateParams(supplierIdParamSchema),
  validateBody(statusSchema),
  setSupplierStatusController,
);
supplierRoutes.get('/:id', auth, tenant, adminOnly, validateParams(supplierIdParamSchema), getSupplierController);
supplierRoutes.put(
  '/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(supplierIdParamSchema),
  validateBody(updateSupplierSchema),
  updateSupplierController,
);
supplierRoutes.delete('/:id', auth, tenant, adminOnly, validateParams(supplierIdParamSchema), deleteSupplierController);
