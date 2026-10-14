import { z } from 'zod';

export const updateRoleSchema = z.object({
  // min(0) — admins can clear all permissions for a role
  permissions: z.array(z.string()),
});

export const roleParamSchema = z.object({
  role: z.enum(['delivery', 'delivery_partner', 'agent']),
});

export const userIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type RoleParam = z.infer<typeof roleParamSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;
