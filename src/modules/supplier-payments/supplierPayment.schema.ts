import { z } from 'zod';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

function todayString(): string {
  return toDateOnlyString(istToday());
}

export const recordSupplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  amount: z.number().positive(),
  date: dateString
    .optional()
    .transform((v) => v ?? todayString()),
  paymentMethod: z.enum(['cash', 'upi', 'bank_transfer']).default('cash'),
  paymentRef: z.string().optional(),
  notes: z.string().optional(),
  settleCollectionIds: z.array(z.string().uuid()).optional(),
  description: z.string().optional(),
});

export const outstandingQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
});

export const collectionTotalQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

export const supplierHistoryQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const supplierHistoryParamSchema = z.object({
  supplierId: z.string().uuid(),
});

export type RecordSupplierPaymentInput = z.infer<typeof recordSupplierPaymentSchema>;
export type OutstandingQuery = z.infer<typeof outstandingQuerySchema>;
export type CollectionTotalQuery = z.infer<typeof collectionTotalQuerySchema>;
export type SupplierHistoryQuery = z.infer<typeof supplierHistoryQuerySchema>;
export type SupplierHistoryParam = z.infer<typeof supplierHistoryParamSchema>;
