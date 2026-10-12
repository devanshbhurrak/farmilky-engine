import { z } from 'zod';

const phoneSchema = z.string().regex(/^[6-9]\d{9}$/);
const roleEnum = z.enum(['customer', 'admin', 'delivery', 'delivery_partner', 'agent', 'supplier']);

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number');

export const customerRegisterSchema = z.object({
  name: z.string().min(1),
  phone: phoneSchema,
  email: z.string().email().optional(),
  password: passwordSchema,
  tenantSlug: z.string().optional(),
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

export const loginSchema = z.object({
  emailOrPhone: z.string().min(1),
  password: z.string().min(1),
  tenantSlug: z.string().min(1, 'tenantSlug is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: phoneSchema.optional(),
  preferredTimeSlot: z.enum(['morning', 'evening', 'anytime']).optional(),
  defaultDeliveryNotes: z.string().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const adminCreateUserSchema = z.object({
  name: z.string().min(1),
  phone: phoneSchema,
  email: z.string().email().optional(),
  password: passwordSchema,
  role: roleEnum,
  assignedAreaId: z.string().uuid().optional(),
  deliverySequence: z.number().int().optional(),
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const adminUpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional().nullable(),
  password: passwordSchema.optional(),
  role: roleEnum.optional(),
  isActive: z.boolean().optional(),
  assignedAreaId: z.string().uuid().optional().nullable(),
  deliverySequence: z.number().int().optional().nullable(),
  preferredTimeSlot: z.enum(['morning', 'evening', 'anytime']).optional().nullable(),
  defaultDeliveryNotes: z.string().optional().nullable(),
  profilePicUrl: z.string().optional().nullable(),
});

export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export const deliveryConfigSchema = z.object({
  assignedAreaId: z.string().uuid().nullable(),
  deliverySequence: z.number().int().nullable(),
});

export type DeliveryConfigInput = z.infer<typeof deliveryConfigSchema>;

export const adminListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  role: z.string().optional(),
  isActive: z.string().optional(),
  balance: z.enum(['positive', 'negative', 'zero']).optional(),
  unassigned: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type UserIdParam = z.infer<typeof userIdParamSchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type RefreshBodyInput = z.infer<typeof refreshBodySchema>;
