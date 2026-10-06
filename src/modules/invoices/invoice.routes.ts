import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { tenant } from '../../shared/middleware/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../shared/middleware/validate.js';
import type { HonoEnv } from '../../shared/types/index.js';
import {
  bulkGenerateInvoicesController,
  downloadInvoicePDFAdminController,
  downloadMyInvoicePDFController,
  generateInvoiceAdminController,
  getInvoiceDetailAdminController,
  getMyInvoiceDetailController,
  listInvoicesAdminController,
  listMyInvoicesController,
  regenerateInvoiceAdminController,
  sendInvoiceWhatsAppController,
  updateInvoiceStatusController,
} from './invoice.controller.js';
import {
  adminInvoiceListQuerySchema,
  bulkGenerateSchema,
  generateSingleSchema,
  generateUserParamSchema,
  invoiceIdParamSchema,
  invoicePdfQuerySchema,
  myInvoiceListQuerySchema,
  regenerateSchema,
  updateStatusSchema,
} from './invoice.schema.js';

export const invoiceRoutes = new Hono<HonoEnv>();

// ── Admin (statics before :id) ──────────────────────────────────────────────
invoiceRoutes.get(
  '/admin',
  auth,
  tenant,
  adminOnly,
  validateQuery(adminInvoiceListQuerySchema),
  listInvoicesAdminController,
);
invoiceRoutes.post(
  '/admin/generate-bulk',
  auth,
  tenant,
  adminOnly,
  validateBody(bulkGenerateSchema),
  bulkGenerateInvoicesController,
);
invoiceRoutes.post(
  '/admin/generate/:userId',
  auth,
  tenant,
  adminOnly,
  validateParams(generateUserParamSchema),
  validateBody(generateSingleSchema),
  generateInvoiceAdminController,
);
invoiceRoutes.get(
  '/admin/:id/pdf',
  auth,
  tenant,
  adminOnly,
  validateParams(invoiceIdParamSchema),
  validateQuery(invoicePdfQuerySchema),
  downloadInvoicePDFAdminController,
);
invoiceRoutes.get(
  '/admin/:id',
  auth,
  tenant,
  adminOnly,
  validateParams(invoiceIdParamSchema),
  getInvoiceDetailAdminController,
);
invoiceRoutes.post(
  '/admin/:id/regenerate',
  auth,
  tenant,
  adminOnly,
  validateParams(invoiceIdParamSchema),
  validateBody(regenerateSchema),
  regenerateInvoiceAdminController,
);
invoiceRoutes.patch(
  '/admin/:id/status',
  auth,
  tenant,
  adminOnly,
  validateParams(invoiceIdParamSchema),
  validateBody(updateStatusSchema),
  updateInvoiceStatusController,
);
invoiceRoutes.post(
  '/admin/:id/send-whatsapp',
  auth,
  tenant,
  adminOnly,
  validateParams(invoiceIdParamSchema),
  sendInvoiceWhatsAppController,
);

// ── Customer ────────────────────────────────────────────────────────────────
invoiceRoutes.get('/my', auth, tenant, validateQuery(myInvoiceListQuerySchema), listMyInvoicesController);
invoiceRoutes.get(
  '/my/:id/pdf',
  auth,
  tenant,
  validateParams(invoiceIdParamSchema),
  validateQuery(invoicePdfQuerySchema),
  downloadMyInvoicePDFController,
);
invoiceRoutes.get('/my/:id', auth, tenant, validateParams(invoiceIdParamSchema), getMyInvoiceDetailController);
