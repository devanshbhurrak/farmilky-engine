import { z } from 'zod';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const phoneSchema = z.string().regex(/^[6-9]\d{9}$/, 'phone must be a 10-digit Indian mobile number');
const pincodeSchema = z.string().regex(/^[1-9][0-9]{5}$/, 'pincode must be a valid 6-digit Indian pincode').optional();

function todayString(): string {
  return toDateOnlyString(istToday());
}

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'name is required'),
  phone: phoneSchema,
  email: z.string().email().optional(),
  location: z.string().optional(),
  pincode: pincodeSchema,
  joiningDate: dateString.optional(),
  morningSession: z.boolean().default(true),
  eveningSession: z.boolean().default(false),
  defaultMorningQty: z.number().min(0).default(0),
  expectedEveningQty: z.number().min(0).default(0),
  defaultRatePerLiter: z.number().min(0).default(0),
  bankAccountNo: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankName: z.string().optional(),
  bankHolderName: z.string().optional(),
  notes: z.string().optional(),
  linkedUserId: z.string().uuid().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const statusSchema = z.object({
  isActive: z.boolean(),
});

export const adjustmentCategorySchema = z.enum([
  'advance',
  'transport',
  'quality_bonus',
  'quality_penalty',
  'rounding',
  'payment_difference',
  'other',
]);

export const adjustmentSchema = z.object({
  amount: z.number().positive(),
  entryType: z.enum(['debit', 'credit']),
  category: adjustmentCategorySchema.default('other'),
  effectiveDate: dateString
    .optional()
    .transform((v) => v ?? todayString()),
  description: z.string().min(1, 'description is required'),
  notes: z.string().optional(),
});

export const deleteAdjustmentSchema = z.object({
  void_reason: z.string().min(1, 'void_reason is required'),
});

export const supplierIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const supplierAdjustmentParamSchema = z.object({
  id: z.string().uuid(),
  adjId: z.string().uuid(),
});

export const supplierListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const supplierPassbookQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type StatusInput = z.infer<typeof statusSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type DeleteAdjustmentInput = z.infer<typeof deleteAdjustmentSchema>;
export type SupplierIdParam = z.infer<typeof supplierIdParamSchema>;
export type SupplierAdjustmentParam = z.infer<typeof supplierAdjustmentParamSchema>;
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
export type SupplierPassbookQuery = z.infer<typeof supplierPassbookQuerySchema>;
