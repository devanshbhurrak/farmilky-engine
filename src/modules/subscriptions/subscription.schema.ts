import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const uuid = z.string().uuid();

export const deliverySlotSchema = z.enum(['morning', 'evening']);
export const deliveryScheduleSchema = z.enum(['daily', 'alternate', 'weekly', 'custom']);
export const deliveryOutcomeSchema = z.enum(['delivered', 'skipped', 'partial', 'extra', 'failed']);
export const subscriptionStatusSchema = z.enum(['active', 'paused', 'cancelled']);
export const dayNameSchema = z.enum([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]);

export const createSubscriptionSchema = z.object({
  productId: uuid,
  variantId: uuid.optional(),
  quantityPerDelivery: z.number().positive('quantityPerDelivery must be positive'),
  deliverySlot: deliverySlotSchema,
  deliverySchedule: deliveryScheduleSchema.default('daily'),
  customDays: z.array(dayNameSchema).default([]),
  startDate: dateString.optional(),
  areaId: uuid.optional(),
});

export const adminCreateSubscriptionSchema = createSubscriptionSchema.extend({
  userId: uuid,
  customPrice: z.number().positive('customPrice must be positive').optional(),
});

export const updateSubscriptionSchema = z.object({
  quantityPerDelivery: z.number().positive('quantityPerDelivery must be positive').optional(),
  deliverySchedule: deliveryScheduleSchema.optional(),
  customDays: z.array(dayNameSchema).optional(),
});

export const adminUpdateSubscriptionSchema = z.object({
  productId: uuid.optional(),
  variantId: uuid.nullable().optional(),
  quantityPerDelivery: z.number().positive('quantityPerDelivery must be positive').optional(),
  deliverySlot: deliverySlotSchema.optional(),
  deliverySchedule: deliveryScheduleSchema.optional(),
  customDays: z.array(dayNameSchema).optional(),
  pricePerPacket: z.number().positive('pricePerPacket must be positive').optional(),
  status: subscriptionStatusSchema.optional(),
  areaId: uuid.nullable().optional(),
});

export const pauseSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const vacationSubscriptionSchema = z.object({
  vacationFrom: dateString,
  vacationUntil: dateString,
});

export const skipSubscriptionSchema = z.object({
  date: dateString,
});

export const scheduleChangeSchema = z
  .object({
    effectiveDate: dateString,
    scheduledQty: z.number().positive('scheduledQty must be positive').optional(),
    scheduledPrice: z.number().positive('scheduledPrice must be positive').optional(),
  })
  .refine((v) => v.scheduledQty !== undefined || v.scheduledPrice !== undefined, {
    message: 'At least one of scheduledQty or scheduledPrice is required',
  });

export const recordDeliveryOutcomeSchema = z
  .object({
    deliveryDate: dateString,
    status: deliveryOutcomeSchema,
    actualQuantity: z.number().positive('actualQuantity must be positive').optional(),
    reason: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.status === 'partial' || v.status === 'extra') && v.actualQuantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'actualQuantity is required for partial/extra outcomes',
        path: ['actualQuantity'],
      });
    }
    if ((v.status === 'skipped' || v.status === 'failed') && !v.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reason is required for skipped/failed outcomes',
        path: ['reason'],
      });
    }
  });

export const agentDeliveryOutcomeSchema = z.object({
  deliveryDate: dateString.optional(),
  status: z.enum(['delivered', 'failed']),
  notes: z.string().max(1000).optional(),
  reason: z.string().max(500).optional(),
});

export const statusUpdateSchema = z.object({
  status: subscriptionStatusSchema,
});

export const bulkIdsSchema = z.object({
  subscriptionIds: z.array(uuid).min(1).max(100),
});

export const subscriptionIdParamSchema = z.object({
  id: uuid,
});

export const deliveryEntryParamSchema = z.object({
  id: uuid,
  entryId: uuid,
});

export const subscriptionUserParamSchema = z.object({
  userId: uuid,
});

export const adminSubscriptionListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: subscriptionStatusSchema.optional(),
  search: z.string().optional(),
});

export const deliveryBoardQuerySchema = z.object({
  date: dateString.optional(),
  slot: deliverySlotSchema.optional(),
});

export const historyQuerySchema = z.object({
  month: z.string().optional(),
  year: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type AdminCreateSubscriptionInput = z.infer<typeof adminCreateSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type AdminUpdateSubscriptionInput = z.infer<typeof adminUpdateSubscriptionSchema>;
export type PauseSubscriptionInput = z.infer<typeof pauseSubscriptionSchema>;
export type VacationSubscriptionInput = z.infer<typeof vacationSubscriptionSchema>;
export type SkipSubscriptionInput = z.infer<typeof skipSubscriptionSchema>;
export type ScheduleChangeInput = z.infer<typeof scheduleChangeSchema>;
export type DeliveryOutcomeInput = z.infer<typeof recordDeliveryOutcomeSchema>;
export type AgentDeliveryOutcomeInput = z.infer<typeof agentDeliveryOutcomeSchema>;
export type StatusUpdateInput = z.infer<typeof statusUpdateSchema>;
export type BulkIdsInput = z.infer<typeof bulkIdsSchema>;
export type SubscriptionIdParam = z.infer<typeof subscriptionIdParamSchema>;
export type DeliveryEntryParam = z.infer<typeof deliveryEntryParamSchema>;
export type SubscriptionUserParam = z.infer<typeof subscriptionUserParamSchema>;
export type AdminSubscriptionListQuery = z.infer<typeof adminSubscriptionListQuerySchema>;
export type DeliveryBoardQuery = z.infer<typeof deliveryBoardQuerySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
