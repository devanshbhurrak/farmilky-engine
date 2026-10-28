import { z } from 'zod';

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'date must be a valid calendar date');
const uuid = z.string().uuid();
const quantitySchema = z.number().min(0.001, 'quantity must be at least 0.001');
const priceSchema = z.number().min(0.01, 'price must be at least 0.01');

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

// Per-slot configuration for a subscription. A subscription may deliver in
// multiple slots (morning and/or evening), each with its own quantity.
export const subscriptionSlotInputSchema = z.object({
  slot: deliverySlotSchema,
  quantityPerDelivery: quantitySchema.optional(),
});

const createSubscriptionBaseSchema = z.object({
  productId: uuid,
  variantId: uuid.optional(),
  // Default quantity: legacy single-slot input and fallback for slot entries
  // that omit their own quantityPerDelivery.
  quantityPerDelivery: quantitySchema,
  // Legacy single-slot input.
  deliverySlot: deliverySlotSchema.optional(),
  // Multi-slot input; when present it takes precedence over deliverySlot.
  deliverySlots: z.array(subscriptionSlotInputSchema).min(1).max(2).optional(),
  deliverySchedule: deliveryScheduleSchema.default('daily'),
  customDays: z.array(dayNameSchema).default([]),
  startDate: dateString.optional(),
  areaId: uuid.optional(),
});

const slotConfigRefine = (
  v: { deliverySlot?: 'morning' | 'evening'; deliverySlots?: Array<{ slot: string }> },
  ctx: z.RefinementCtx,
) => {
  if (v.deliverySlots?.length) {
    const seen = new Set<string>();
    for (const entry of v.deliverySlots) {
      if (seen.has(entry.slot)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate slot: ${entry.slot}`,
          path: ['deliverySlots'],
        });
      }
      seen.add(entry.slot);
    }
    return;
  }
  if (!v.deliverySlot) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'deliverySlot or deliverySlots is required',
      path: ['deliverySlot'],
    });
  }
};

const customScheduleRefine = (
  v: { deliverySchedule?: string; customDays?: string[] },
  ctx: z.RefinementCtx,
) => {
  if (v.deliverySchedule === 'custom' && !v.customDays?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select at least one delivery day for a custom schedule',
      path: ['customDays'],
    });
  }
};

const createSubscriptionRefine = (v: z.infer<typeof createSubscriptionBaseSchema>, ctx: z.RefinementCtx) => {
  slotConfigRefine(v, ctx);
  customScheduleRefine(v, ctx);
};

export const createSubscriptionSchema = createSubscriptionBaseSchema.superRefine(createSubscriptionRefine);

export const adminCreateSubscriptionSchema = createSubscriptionBaseSchema
  .extend({
    userId: uuid,
    customPrice: priceSchema.optional(),
  })
  .superRefine((v, ctx) => {
    slotConfigRefine(v, ctx);
    customScheduleRefine(v, ctx);
  });

export const updateSubscriptionSchema = z.object({
  quantityPerDelivery: quantitySchema.optional(),
  deliverySchedule: deliveryScheduleSchema.optional(),
  customDays: z.array(dayNameSchema).optional(),
});

export const adminUpdateSubscriptionSchema = z.object({
  productId: uuid.optional(),
  variantId: uuid.nullable().optional(),
  quantityPerDelivery: quantitySchema.optional(),
  deliverySlot: deliverySlotSchema.optional(),
  // Per-slot quantities for multi-slot subscriptions. The set of slots is
  // immutable (cancel + recreate to change it); only quantities may change.
  deliverySlots: z.array(subscriptionSlotInputSchema).min(1).max(2).optional(),
  deliverySchedule: deliveryScheduleSchema.optional(),
  customDays: z.array(dayNameSchema).optional(),
  pricePerPacket: priceSchema.optional(),
  status: subscriptionStatusSchema.optional(),
  areaId: uuid.nullable().optional(),
}).superRefine(customScheduleRefine);

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
    scheduledQty: quantitySchema.optional(),
    scheduledPrice: priceSchema.optional(),
    deliverySchedule: deliveryScheduleSchema.optional(),
    customDays: z.array(dayNameSchema).optional(),
    // Target slot for scheduledQty on multi-slot subscriptions.
    slot: deliverySlotSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.scheduledQty === undefined &&
      v.scheduledPrice === undefined &&
      v.deliverySchedule === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide a quantity, price, or schedule change',
      });
    }
    customScheduleRefine(v, ctx);
  });

export const recordDeliveryOutcomeSchema = z
  .object({
    deliveryDate: dateString,
    // Required only for multi-slot subscriptions; defaults to the sole slot.
    slot: deliverySlotSchema.optional(),
    status: deliveryOutcomeSchema,
    actualQuantity: quantitySchema.optional(),
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

export const agentDeliveryOutcomeSchema = z
  .object({
    deliveryDate: dateString.optional(),
    slot: deliverySlotSchema.optional(),
    status: z.enum(['delivered', 'failed']),
    notes: z.string().max(1000).optional(),
    reason: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'failed' && !v.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reason is required for failed outcomes',
        path: ['reason'],
      });
    }
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
  schedule: deliveryScheduleSchema.optional(),
  productId: uuid.optional(),
  sortBy: z.enum(['createdAt', 'quantityPerDelivery', 'pricePerPacket']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const deliveryBoardQuerySchema = z.object({
  date: dateString.optional(),
  slot: deliverySlotSchema.optional(),
});

export const historyQuerySchema = z.object({
  month: z.string().regex(/^(?:[1-9]|1[0-2])$/).optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});

export type SubscriptionSlotInput = z.infer<typeof subscriptionSlotInputSchema>;
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
