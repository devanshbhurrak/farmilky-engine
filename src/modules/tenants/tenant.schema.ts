import { z } from 'zod';

export const registerTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  brandPhone: z.string().optional(),
  upiId: z.string().optional(),
  upiName: z.string().optional(),
  brandLogoUrl: z.string().optional(),
  backendUrl: z.string().optional(),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPhone: z.string().regex(/^[6-9]\d{9}$/),
  adminPassword: z.string().min(6),
});

export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;

export const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  brandPhone: z.string().optional(),
  upiId: z.string().optional(),
  upiName: z.string().optional(),
  brandLogoUrl: z.string().optional(),
  backendUrl: z.string().optional(),
  // Per-tenant business-rule overrides (return window, vacation cap, ...).
  tenantSettings: z
    .object({
      returnWindowMs: z.number().positive().optional(),
      vacationMaxDays: z.number().int().positive().optional(),
    })
    .optional(),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
