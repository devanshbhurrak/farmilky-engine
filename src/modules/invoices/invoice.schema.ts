import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const invoiceStatusSchema = z.enum([
  'draft',
  'sent',
  'paid',
  'partially_paid',
  'overdue',
  'cancelled',
  'void',
]);

export const invoiceIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const generateUserParamSchema = z.object({
  userId: z.string().uuid(),
});

export const adminInvoiceListQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  status: invoiceStatusSchema.optional(),
  userId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const myInvoiceListQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

// Month/year optional — defaults to the current month when omitted.
export const generateSingleSchema = z.object({
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  force: z.boolean().optional(),
  isEarlyBilling: z.boolean().optional(),
  billingCutoffDate: dateString.optional(),
  notes: z.string().optional(),
});

export const bulkGenerateSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  force: z.boolean().optional(),
  isEarlyBilling: z.boolean().optional(),
  billingCutoffDate: dateString.optional(),
});

export const regenerateSchema = z.object({
  notes: z.string().optional(),
});

export const updateStatusSchema = z.object({
  status: invoiceStatusSchema,
  voidReason: z.string().optional(),
});

export const invoicePdfQuerySchema = z.object({
  detailed: z.string().optional(),
  upiId: z.string().optional(),
  upiName: z.string().optional(),
  phone: z.string().optional(),
});

export type InvoiceIdParam = z.infer<typeof invoiceIdParamSchema>;
export type GenerateUserParam = z.infer<typeof generateUserParamSchema>;
export type AdminInvoiceListQuery = z.infer<typeof adminInvoiceListQuerySchema>;
export type MyInvoiceListQuery = z.infer<typeof myInvoiceListQuerySchema>;
export type GenerateSingleInput = z.infer<typeof generateSingleSchema>;
export type BulkGenerateInput = z.infer<typeof bulkGenerateSchema>;
export type RegenerateInput = z.infer<typeof regenerateSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type InvoicePdfQuery = z.infer<typeof invoicePdfQuerySchema>;
