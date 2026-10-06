import { z } from 'zod';

export const createAreaSchema = z.object({
  name: z.string().min(1),
  pincodes: z.array(z.string()).default([]),
  localities: z.array(z.string()).default([]),
  assignedAgentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateAreaSchema = createAreaSchema.partial();

export const areaListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const areaIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const areaCustomersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const assignCustomersSchema = z.object({
  assign: z
    .array(
      z.object({
        userId: z.string().uuid(),
        deliverySequence: z.number().int().min(0).optional(),
      }),
    )
    .default([]),
  remove: z.array(z.string().uuid()).default([]),
});

export type CreateAreaInput = z.infer<typeof createAreaSchema>;
export type UpdateAreaInput = z.infer<typeof updateAreaSchema>;
export type AreaListQuery = z.infer<typeof areaListQuerySchema>;
export type AreaIdParam = z.infer<typeof areaIdParamSchema>;
export type AreaCustomersQuery = z.infer<typeof areaCustomersQuerySchema>;
export type AssignCustomersInput = z.infer<typeof assignCustomersSchema>;
