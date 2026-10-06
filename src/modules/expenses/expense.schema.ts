import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const expenseCategorySchema = z.enum([
  'fuel_transport',
  'packaging',
  'equipment',
  'salaries',
  'rent',
  'utilities',
  'maintenance',
  'marketing',
  'miscellaneous',
]);

export const createExpenseSchema = z.object({
  amount: z.number().positive(),
  category: expenseCategorySchema,
  effectiveDate: dateString.optional(),
  description: z.string().min(1),
  notes: z.string().optional(),
  paymentMethod: z.enum(['cash', 'upi', 'bank_transfer', 'card', 'online', 'COD']).optional(),
});

export const updateExpenseSchema = z.object({
  void_reason: z.string().min(1, 'void_reason is required'),
  amount: z.number().positive().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().optional(),
  category: expenseCategorySchema.optional(),
  effectiveDate: dateString.optional(),
});

export const deleteExpenseSchema = z.object({
  void_reason: z.string().min(1, 'void_reason is required'),
});

export const expenseQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  category: expenseCategorySchema.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

export const expenseSummaryQuerySchema = z.object({
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

export const expenseIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type DeleteExpenseInput = z.infer<typeof deleteExpenseSchema>;
export type ExpenseQuery = z.infer<typeof expenseQuerySchema>;
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;
export type ExpenseIdParam = z.infer<typeof expenseIdParamSchema>;
