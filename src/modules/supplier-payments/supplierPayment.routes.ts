import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  collectionTotalController,
  listSupplierPaymentsController,
  outstandingController,
  recordSupplierPaymentController,
  supplierPaymentHistoryController,
} from './supplierPayment.controller.js';
import {
  collectionTotalQuerySchema,
  listSupplierPaymentsQuerySchema,
  outstandingQuerySchema,
  recordSupplierPaymentSchema,
  supplierHistoryParamSchema,
  supplierHistoryQuerySchema,
} from './supplierPayment.schema.js';

export const supplierPaymentRoutes = new Hono<HonoEnv>();

supplierPaymentRoutes.get(
  '/outstanding',
  auth,
  tenant,
  adminOnly,
  validateQuery(outstandingQuerySchema),
  outstandingController,
);
supplierPaymentRoutes.get(
  '/collection-total',
  auth,
  tenant,
  adminOnly,
  validateQuery(collectionTotalQuerySchema),
  collectionTotalController,
);
supplierPaymentRoutes.get(
  '/',
  auth,
  tenant,
  adminOnly,
  validateQuery(listSupplierPaymentsQuerySchema),
  listSupplierPaymentsController,
);
supplierPaymentRoutes.post(
  '/',
  auth,
  tenant,
  adminOnly,
  validateBody(recordSupplierPaymentSchema),
  recordSupplierPaymentController,
);
supplierPaymentRoutes.get(
  '/:supplierId',
  auth,
  tenant,
  adminOnly,
  validateParams(supplierHistoryParamSchema),
  validateQuery(supplierHistoryQuerySchema),
  supplierPaymentHistoryController,
);
