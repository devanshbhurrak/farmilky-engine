import { z } from 'zod';

export const txnTypeSchema = z.enum([
  'delivery',
  'order',
  'payment',
  'credit_adjustment',
  'debit_adjustment',
  'return_refund',
  'opening_balance',
  'milk_collection',
  'supplier_payment',
  'supplier_adjustment',
  'expense',
]);

export const createTxnItemSchema = z.object({
  description: z.string().min(1),
  productId: z.string().uuid().optional(),
  productName: z.string().optional(),
  variantLabel: z.string().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().optional(),
  rate: z.number().nonnegative().optional(),
  amount: z.number().positive(),
  referenceType: z.string().optional(),
  referenceId: z.string().uuid().optional(),
  sortOrder: z.number().int().default(0),
});

export const voidTxnSchema = z.object({
  // defaults to 'Admin action' so callers that omit it still succeed
  void_reason: z.string().min(1).default('Admin action'),
});

export const editTxnSchema = z.object({
  // defaults to 'Admin action' so callers that omit it still succeed
  void_reason: z.string().min(1).default('Admin action'),
  amount: z.number().positive().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  txnCategory: z.string().optional(),
  paymentMethod: z.string().optional(),
  paymentRef: z.string().optional(),
});

export const txnHistoryQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  month: z.string().optional(),
  year: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const txnIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateTxnItemInput = z.infer<typeof createTxnItemSchema>;
export type VoidTxnInput = z.infer<typeof voidTxnSchema>;
export type EditTxnInput = z.infer<typeof editTxnSchema>;
