import { z } from 'zod';

export const createContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  message: z.string().min(1),
  tenantSlug: z.string().min(1).optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(['unread', 'read', 'replied']),
});

export const contactAdminListQuerySchema = z.object({
  status: z.enum(['unread', 'read', 'replied']).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const contactIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactStatusInput = z.infer<typeof updateStatusSchema>;
export type ContactAdminListQuery = z.infer<typeof contactAdminListQuerySchema>;
export type ContactIdParam = z.infer<typeof contactIdParamSchema>;
