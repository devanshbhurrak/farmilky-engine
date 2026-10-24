import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const paymentMethodSchema = z.enum(['cash', 'upi', 'bank_transfer', 'card', 'online', 'COD']);

export const recordPaymentSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: paymentMethodSchema.default('cash'),
  paymentRef: z.string().optional(),
  // 'transactionId' is the field name used by frontend forms — accepted as alias for paymentRef
  transactionId: z.string().optional(),
  receivedDate: dateString.optional(),
  // 'date' is accepted as alias for receivedDate from frontend forms that use that field name
  date: dateString.optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

export const updatePaymentSchema = z.object({
  // defaults to 'Admin action' so frontend forms that omit it still succeed
  void_reason: z.string().min(1).default('Admin action'),
  amount: z.number().positive().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().optional(),
  paymentMethod: paymentMethodSchema.optional(),
  receivedDate: dateString.optional(),
  // 'date' alias accepted from frontend
  date: dateString.optional(),
});

export const deletePaymentSchema = z.object({
  // defaults to 'Admin action' so frontend forms that omit it still succeed
  void_reason: z.string().min(1).default('Admin action'),
});

export const passbookQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const ledgerQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export const paymentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const paymentUserParamSchema = z.object({
  userId: z.string().uuid(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type DeletePaymentInput = z.infer<typeof deletePaymentSchema>;
export type PassbookQuery = z.infer<typeof passbookQuerySchema>;
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
export type PaymentIdParam = z.infer<typeof paymentIdParamSchema>;
export type PaymentUserParam = z.infer<typeof paymentUserParamSchema>;
