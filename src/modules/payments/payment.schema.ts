import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const paymentMethodSchema = z.enum(['cash', 'upi', 'bank_transfer', 'card', 'online', 'COD']);

export const recordPaymentSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: paymentMethodSchema.default('cash'),
  paymentRef: z.string().optional(),
  receivedDate: dateString.optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

export const updatePaymentSchema = z.object({
  void_reason: z.string().min(1, 'void_reason is required'),
  amount: z.number().positive().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().optional(),
  paymentMethod: paymentMethodSchema.optional(),
  receivedDate: dateString.optional(),
});

export const deletePaymentSchema = z.object({
  void_reason: z.string().min(1, 'void_reason is required'),
});

export const passbookQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
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
export type PaymentIdParam = z.infer<typeof paymentIdParamSchema>;
export type PaymentUserParam = z.infer<typeof paymentUserParamSchema>;
