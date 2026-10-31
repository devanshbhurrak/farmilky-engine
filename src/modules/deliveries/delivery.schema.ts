import { z } from 'zod';

const uuid = z.string().uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const deliveryTypeSchema = z.enum(['subscription', 'order', 'instant']);
export const deliveryStatusSchema = z.enum([
  'pending',
  'delivered',
  'skipped',
  'partial',
  'extra',
  'failed',
  'missed',
]);
export const deliveryPaymentModeSchema = z.enum(['pay_at_delivery', 'subscription_ledger', 'prepaid']);
export const deliveryPaymentStatusSchema = z.enum(['pending', 'paid', 'partially_paid', 'failed']);
export const deliverySlotSchema = z.enum(['morning', 'evening']);

const chargeableStatuses = new Set(['delivered', 'partial', 'extra']);

export const deliveryItemInputSchema = z.object({
  productId: uuid,
  // Accept empty string and treat as undefined (optional field)
  variantId: z.union([uuid, z.literal('')]).optional().transform((v) => (v === '' ? undefined : v)),
  productName: z.string().min(1).max(255),
  variantLabel: z.string().max(120).optional(),
  unit: z.string().max(60).optional(),
  quantity: z.coerce.number().int().positive('Quantity must be a positive whole number'),
  unitPrice: z.coerce.number().nonnegative('Unit price cannot be negative'),
  // Actual delivered quantity for this item (defaults to scheduled quantity
  // when the item is fully delivered).
  deliveredQuantity: z.coerce.number().nonnegative().optional(),
  // Per-item outcome: pending / delivered / partial / failed / skipped.
  status: deliveryStatusSchema.optional(),
  failureReason: z.string().max(500).optional(),
  failureNotes: z.string().max(1000).optional(),
});

export type DeliveryItemInput = z.infer<typeof deliveryItemInputSchema>;

/**
 * Record or correct a delivery outcome for a specific customer.
 *
 * Idempotency: supply `idempotencyKey` to safely retry a delivery recording
 * without creating duplicates. Optimistic concurrency: supply `expectedVersion`
 * when correcting an existing record.
 */
export const recordDeliveryOutcomeSchema = z
  .object({
    customerId: uuid,
    type: deliveryTypeSchema,
    // What this delivery fulfils (optional for ad-hoc instant deliveries).
    referenceType: z.enum(['subscription', 'order']).optional(),
    // Accept empty string and treat as undefined (optional field)
    referenceId: z.union([uuid, z.literal('')]).optional().transform((v) => (v === '' ? undefined : v)),
    deliveryDate: dateString,
    deliverySlot: deliverySlotSchema.optional(),
    status: deliveryStatusSchema,
    scheduledQuantity: z.coerce.number().nonnegative().optional(),
    actualQuantity: z.coerce.number().nonnegative().optional(),
    pricePerPacket: z.coerce.number().nonnegative().optional(),
    items: z.array(deliveryItemInputSchema).optional(),
    paymentMode: deliveryPaymentModeSchema.optional(),
    reason: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
    // Idempotency key for safe retries (mutations only).
    idempotencyKey: z.string().min(1).max(128).optional(),
    // Expected current version for optimistic locking on corrections.
    expectedVersion: z.coerce.number().int().nonnegative().optional(),
    // Delivery-time payment (optional)
    paymentReceived: z
      .object({
        amount: z.coerce.number().positive('Payment amount must be positive'),
        paymentMethod: z.string().min(1).default('cash'),
        paymentRef: z.string().max(255).optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if ((v.status === 'partial' || v.status === 'extra') && v.actualQuantity == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actualQuantity'],
        message: `actualQuantity is required for ${v.status} outcomes`,
      });
    }
    if ((v.status === 'failed' || v.status === 'skipped' || v.status === 'missed') && !v.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: `reason is required for ${v.status} outcomes`,
      });
    }
    if (v.referenceType === 'subscription' && !v.referenceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceId'],
        message: 'referenceId is required for subscription deliveries',
      });
    }
    if (v.referenceType === 'order' && !v.referenceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceId'],
        message: 'referenceId is required for order deliveries',
      });
    }
  });

export type RecordDeliveryOutcomeInput = z.infer<typeof recordDeliveryOutcomeSchema>;

export const rescheduleDeliverySchema = z.object({
  newDeliveryDate: dateString,
  newDeliverySlot: deliverySlotSchema.optional(),
  reason: z.string().min(1, 'A reason is required for rescheduling').max(500),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export type RescheduleDeliveryInput = z.infer<typeof rescheduleDeliverySchema>;

export const cancelDeliverySchema = z.object({
  reason: z.string().min(1, 'A reason is required for cancellation').max(500),
  restock: z.boolean().default(true),
});

export type CancelDeliveryInput = z.infer<typeof cancelDeliverySchema>;

export const markMissedSchema = z.object({
  beforeDate: dateString.optional(), // mark deliveries on/before this date as missed
});

export type MarkMissedInput = z.infer<typeof markMissedSchema>;

export const deliveryIdParamSchema = z.object({ id: uuid });
export type DeliveryIdParam = z.infer<typeof deliveryIdParamSchema>;

export const correctDeliveryBodySchema = z.object({
  status: deliveryStatusSchema.optional(),
  actualQuantity: z.coerce.number().nonnegative().optional(),
  scheduledQuantity: z.coerce.number().nonnegative().optional(),
  pricePerPacket: z.coerce.number().nonnegative().optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  expectedVersion: z.coerce.number().int().nonnegative(),
});
export type CorrectDeliveryBody = z.infer<typeof correctDeliveryBodySchema>;

export const recordPaymentBodySchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive'),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  paymentRef: z.string().optional(),
  receivedDate: dateString.optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});
export type RecordPaymentBody = z.infer<typeof recordPaymentBodySchema>;

export const deliveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  customerId: uuid.optional(),
  type: deliveryTypeSchema.optional(),
  status: deliveryStatusSchema.optional(),
  paymentStatus: deliveryPaymentStatusSchema.optional(),
  date: dateString.optional(),
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
  slot: deliverySlotSchema.optional(),
  search: z.string().max(120).optional(),
  sortBy: z.enum(['deliveryDate', 'createdAt', 'totalAmount', 'customerName']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type DeliveryQuery = z.infer<typeof deliveryQuerySchema>;

export const unconfirmedDeliveriesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
  slot: deliverySlotSchema.optional(),
});
export type UnconfirmedDeliveriesQuery = z.infer<typeof unconfirmedDeliveriesQuerySchema>;

export const confirmUnconfirmedDeliveriesSchema = unconfirmedDeliveriesQuerySchema;
export type ConfirmUnconfirmedDeliveriesInput = z.infer<typeof confirmUnconfirmedDeliveriesSchema>;

export const customerDeliverySummarySchema = z.object({
  customerId: uuid,
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
});

export type CustomerDeliverySummaryInput = z.infer<typeof customerDeliverySummarySchema>;

export const sessionStateQuerySchema = z.object({
  date: dateString.optional(),
});
export type SessionStateQuery = z.infer<typeof sessionStateQuerySchema>;
