import type { Context } from 'hono';
import type { AuthUser } from '../../shared/types/index.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { created, fail, ok, paginated } from '../../shared/utils/response.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import {
  generateInvoice,
  generateBulkInvoices,
  getInvoiceDetail,
  getMyInvoiceDetail,
} from './invoice.service.js';
import * as invoiceRepo from './invoice.repository.js';
import { generateInvoicePDF } from '../../shared/services/pdfService.js';
import { sendInvoiceViaWhatsApp } from '../../shared/services/whatsappService.js';
import type {
  AdminInvoiceListQuery,
  BulkGenerateInput,
  GenerateSingleInput,
  GenerateUserParam,
  InvoiceIdParam,
  InvoicePdfQuery,
  MyInvoiceListQuery,
  RegenerateInput,
  UpdateStatusInput,
} from './invoice.schema.js';

// ── Admin ───────────────────────────────────────────────────────────────────

export const listInvoicesAdminController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as AdminInvoiceListQuery;
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await invoiceRepo.listAdmin(
    user.tenantId,
    {
      status: query.status,
      month: query.month,
      year: query.year,
      userId: query.userId,
      search: query.search,
    },
    { limit, offset },
  );
  return paginated(c, rows, buildMeta(total, page, limit));
};

export const getInvoiceDetailAdminController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as InvoiceIdParam;
  const detail = await getInvoiceDetail(user.tenantId, params.id);
  return ok(c, detail);
};

function currentMonthYear(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export const generateInvoiceAdminController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as GenerateUserParam;
  const body = (c.get('body') ?? {}) as GenerateSingleInput;
  const now = currentMonthYear();
  const result = await generateInvoice(user.tenantId, params.userId, body.month ?? now.month, body.year ?? now.year, {
    force: body.force ?? false,
    isEarlyBilling: body.isEarlyBilling ?? false,
    billingCutoffDate: body.billingCutoffDate,
    generatedBy: 'admin',
    adminId: user.id,
    notes: body.notes,
  });
  const message =
    result.action === 'skipped'
      ? 'Invoice already exists for this period. Use force=true to regenerate.'
      : result.action === 'regenerated'
        ? 'Invoice regenerated successfully.'
        : 'Invoice generated successfully.';
  if (result.action === 'skipped') return ok(c, { message, invoice: result.invoice, action: result.action });
  return created(c, { message, invoice: result.invoice, action: result.action });
};

export const bulkGenerateInvoicesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as BulkGenerateInput;
  const results = await generateBulkInvoices(user.tenantId, body.month, body.year, {
    force: body.force ?? false,
    isEarlyBilling: body.isEarlyBilling ?? false,
    billingCutoffDate: body.billingCutoffDate,
    generatedBy: 'admin',
    adminId: user.id,
  });
  return ok(c, {
    message: `Bulk generation complete: ${results.generated} generated, ${results.skipped} skipped, ${results.errors.length} errors.`,
    ...results,
  });
};

export const regenerateInvoiceAdminController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as InvoiceIdParam;
  const body = (c.get('body') ?? {}) as RegenerateInput;
  const invoice = await invoiceRepo.findById(user.tenantId, params.id);
  if (!invoice) throw new AppError('Invoice not found', 404);
  const result = await generateInvoice(user.tenantId, invoice.userId, invoice.billingMonth, invoice.billingYear, {
    force: true,
    isEarlyBilling: invoice.isEarlyBilling,
    billingCutoffDate: invoice.billingCutoffDate ?? undefined,
    generatedBy: 'admin',
    adminId: user.id,
    notes: body.notes,
  });
  return ok(c, { message: 'Invoice regenerated.', invoice: result.invoice });
};

export const updateInvoiceStatusController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as InvoiceIdParam;
  const body = c.get('body') as UpdateStatusInput;

  const invoice = await invoiceRepo.findById(user.tenantId, params.id);
  if (!invoice) throw new AppError('Invoice not found', 404);

  if (invoice.status === 'void' && body.status !== 'void') {
    return fail(c, 'Cannot update status of a voided invoice. Regenerate it instead.', 400);
  }
  if (body.status === 'void' && !body.voidReason?.trim()) {
    return fail(c, 'A reason is required when voiding an invoice.', 400);
  }

  const patch: {
    status?: UpdateStatusInput['status'];
    voidReason?: string;
    voidedByUserId?: string;
    paidAt?: Date | null;
    sentAt?: Date;
    sentVia?: 'whatsapp' | 'email' | 'manual';
  } = {
    status: body.status,
  };
  if (body.status === 'void') {
    patch.voidReason = body.voidReason!.trim();
    patch.voidedByUserId = user.id;
  }
  if (body.status === 'paid' && !invoice.paidAt) patch.paidAt = new Date();
  if (body.status === 'sent' && !invoice.sentAt) {
    patch.sentAt = new Date();
    patch.sentVia = 'whatsapp';
  }

  const updated = await invoiceRepo.updateInvoice(user.tenantId, params.id, patch);
  return ok(c, { message: 'Status updated.', invoice: updated });
};

export const sendInvoiceWhatsAppController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as InvoiceIdParam;
  const result = await sendInvoiceViaWhatsApp(user.tenantId, params.id, user.id);
  return ok(c, result);
};

export const downloadInvoicePDFAdminController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as InvoiceIdParam;
  const query = (c.get('query') ?? {}) as InvoicePdfQuery;
  const detail = await getInvoiceDetail(user.tenantId, params.id);
  const pdfBuffer = await generateInvoicePDF(
    {
      ...detail.invoice,
      lineItems: detail.lineItems,
      productSummary: detail.productSummary,
      customer: detail.customer,
    },
    {
      detailed: query.detailed === 'true',
      tenantId: user.tenantId,
      ...(query.upiId ? { upiId: query.upiId } : {}),
      ...(query.upiName ? { upiName: query.upiName } : {}),
      ...(query.phone ? { phone: query.phone } : {}),
    },
  );
  return c.body(new Uint8Array(pdfBuffer), 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${detail.invoice.invoiceNumber}.pdf"`,
  });
};

// ── Customer ────────────────────────────────────────────────────────────────

export const listMyInvoicesController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const query = (c.get('query') ?? {}) as MyInvoiceListQuery;
  const { page, limit, offset } = parsePagination({ ...query, limit: query.limit ?? 12 });
  const { rows, total } = await invoiceRepo.listByUser(
    user.tenantId,
    user.id,
    { month: query.month, year: query.year, excludeVoided: true },
    { limit, offset },
  );
  return paginated(c, rows, buildMeta(total, page, limit));
};

export const getMyInvoiceDetailController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as InvoiceIdParam;
  const detail = await getMyInvoiceDetail(user.tenantId, user.id, params.id);
  return ok(c, detail);
};

export const downloadMyInvoicePDFController = async (c: Context) => {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as InvoiceIdParam;
  const query = (c.get('query') ?? {}) as InvoicePdfQuery;
  const detail = await getMyInvoiceDetail(user.tenantId, user.id, params.id);
  const pdfBuffer = await generateInvoicePDF(
    {
      ...detail.invoice,
      lineItems: detail.lineItems,
      productSummary: detail.productSummary,
    },
    { detailed: query.detailed === 'true', tenantId: user.tenantId },
  );
  return c.body(new Uint8Array(pdfBuffer), 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${detail.invoice.invoiceNumber}.pdf"`,
  });
};
