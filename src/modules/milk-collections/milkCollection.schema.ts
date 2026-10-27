import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const generateSchema = z.object({
  date: dateString,
});

export const dailyQuerySchema = z.object({
  date: dateString.optional(),
});

export const confirmSchema = z.object({
  actualQty: z.number().min(0),
  ratePerLiter: z.number().min(0),
  fatContent: z.number().min(0).optional(),
  snf: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export const bulkConfirmSchema = z.object({
  date: dateString,
  ratePerLiter: z.number().min(0).optional(),
  session: z.enum(['morning', 'evening', 'both']).default('both'),
});

export const updateCollectionSchema = z.object({
  void_reason: z.string().min(1, 'void_reason is required').optional(),
  actualQty: z.number().min(0).optional(),
  ratePerLiter: z.number().min(0).optional(),
  fatContent: z.number().min(0).nullable().optional(),
  snf: z.number().min(0).nullable().optional(),
  notes: z.string().optional(),
});

export const historyQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  status: z.enum(['pending', 'confirmed']).optional(),
});

export const missingQuerySchema = z.object({
  startDate: dateString,
  endDate: dateString,
});

export const collectionIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type GenerateInput = z.infer<typeof generateSchema>;
export type DailyQuery = z.infer<typeof dailyQuerySchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
export type BulkConfirmInput = z.infer<typeof bulkConfirmSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type MissingQuery = z.infer<typeof missingQuerySchema>;
export type CollectionIdParam = z.infer<typeof collectionIdParamSchema>;
