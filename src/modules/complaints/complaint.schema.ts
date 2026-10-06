import { z } from 'zod';

export const createComplaintSchema = z.object({
  relatedTo: z.enum(['order', 'subscription', 'delivery', 'product', 'other']),
  referenceId: z.string().uuid().optional(),
  referenceType: z.enum(['order', 'subscription', 'delivery_manifest', 'product']).optional(),
  subject: z.string().min(1),
  description: z.string().min(1),
});

export const updateComplaintStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
  resolution: z.string().optional(),
});

export const complaintListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
});

export const complaintIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type UpdateComplaintStatusInput = z.infer<typeof updateComplaintStatusSchema>;
export type ComplaintListQuery = z.infer<typeof complaintListQuerySchema>;
export type ComplaintIdParam = z.infer<typeof complaintIdParamSchema>;
