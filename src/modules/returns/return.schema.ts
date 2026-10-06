import { z } from 'zod';

export const createReturnSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});

export const updateReturnStatusSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'completed']),
    adminNotes: z.string().optional(),
    refundAmount: z.number().positive().optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.status === 'approved' || val.status === 'completed') && val.refundAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'refundAmount is required and must be greater than 0 when status is approved or completed',
        path: ['refundAmount'],
      });
    }
  });

export const returnListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['requested', 'approved', 'rejected', 'completed']).optional(),
});

export const returnIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type UpdateReturnStatusInput = z.infer<typeof updateReturnStatusSchema>;
export type ReturnListQuery = z.infer<typeof returnListQuerySchema>;
export type ReturnIdParam = z.infer<typeof returnIdParamSchema>;
