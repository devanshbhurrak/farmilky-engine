import { z } from 'zod';

export const updateRoleSchema = z.object({
  permissions: z.array(z.string()).min(1),
});

export const roleParamSchema = z.object({
  role: z.enum(['delivery', 'delivery_partner', 'agent']),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type RoleParam = z.infer<typeof roleParamSchema>;
