import { z } from 'zod';

const uuid = z.string().uuid();
const phoneSchema = z
  .string()
  .regex(/^[6-9]\d{9}$/, 'phone must be a valid 10-digit Indian mobile number');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const agentRoleSchema = z.enum(['agent', 'delivery', 'delivery_partner']);

export const createAgentSchema = z.object({
  name: z.string().min(1),
  phone: phoneSchema,
  email: z.string().email().optional(),
  password: z.string().min(6),
  role: agentRoleSchema.default('delivery'),
  assignedAreaId: uuid.optional(),
  deliverySequence: z.number().int().min(0).optional(),
  joiningDate: dateString.optional(),
  vehicleType: z.string().max(120).optional(),
  maxCapacity: z.number().int().min(0).optional(),
});

// NOTE: `role` is intentionally omitted. Zod strips unknown keys by default,
// so a `role` sent by the client is ignored here — an agent's role can never
// be changed through this endpoint (the service also defensively drops it).
export const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().nullable().optional(),
  password: z.string().min(6).optional(),
  assignedAreaId: uuid.nullable().optional(),
  deliverySequence: z.number().int().min(0).nullable().optional(),
  joiningDate: dateString.nullable().optional(),
  vehicleType: z.string().max(120).nullable().optional(),
  maxCapacity: z.number().int().min(0).nullable().optional(),
});

export const agentStatusSchema = z.object({
  isActive: z.boolean(),
});

export const assignAreaSchema = z.object({
  areaId: uuid.nullable(),
});

export const agentListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
});

export const agentIdParamSchema = z.object({
  id: uuid,
});

export const agentPerformanceQuerySchema = z.object({
  startDate: dateString.optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type AgentStatusInput = z.infer<typeof agentStatusSchema>;
export type AssignAreaInput = z.infer<typeof assignAreaSchema>;
export type AgentListQuery = z.infer<typeof agentListQuerySchema>;
export type AgentIdParam = z.infer<typeof agentIdParamSchema>;
export type AgentPerformanceQuery = z.infer<typeof agentPerformanceQuerySchema>;
