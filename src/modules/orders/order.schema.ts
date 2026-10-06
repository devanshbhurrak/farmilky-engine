import { z } from 'zod';

const uuid = z.string().uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const deliverySlotSchema = z.enum(['morning', 'evening']);
export const paymentMethodSchema = z.enum(['COD', 'online']);
export const billingModeSchema = z.enum(['pay_at_delivery', 'subscription_ledger']);
export const orderStatusEnumSchema = z.enum(['placed', 'confirmed', 'delivered', 'cancelled']);
export const paymentStatusSchema = z.enum(['pending', 'paid', 'failed']);

export const addressInputSchema = z.object({
  street: z.string().min(1).max(255).optional(),
  city: z.string().min(1).max(120).optional(),
  state: z.string().min(1).max(120).optional(),
  pincode: z.string().min(1).max(12).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const placeOrderSchema = z.object({
  deliveryDate: dateString.optional(),
  deliverySlot: deliverySlotSchema.optional(),
  paymentMethod: paymentMethodSchema.default('COD'),
  billingMode: billingModeSchema.default('pay_at_delivery'),
  address: addressInputSchema.optional(),
});

export const orderItemInputSchema = z.object({
  productId: uuid,
  variantId: uuid.optional(),
  quantity: z.number().int().positive(),
});

export const adminCreateOrderSchema = z.object({
  userId: uuid,
  items: z.array(orderItemInputSchema).min(1),
  deliveryDate: dateString.optional(),
  deliverySlot: deliverySlotSchema.optional(),
  paymentMethod: paymentMethodSchema.default('COD'),
  billingMode: billingModeSchema.default('pay_at_delivery'),
  address: addressInputSchema.optional(),
});

export const instantDeliverySchema = z.object({
  userId: uuid,
  items: z.array(orderItemInputSchema).min(1),
  paymentMethod: paymentMethodSchema.default('COD'),
  billingMode: billingModeSchema.default('pay_at_delivery'),
  deliverySlot: deliverySlotSchema.optional(),
  address: addressInputSchema.optional(),
});

export const updateOrderSchema = z.object({
  status: orderStatusEnumSchema.optional(),
  paymentStatus: paymentStatusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  billingMode: billingModeSchema.optional(),
  deliveryDate: dateString.nullable().optional(),
  deliverySlot: deliverySlotSchema.nullable().optional(),
  assignedAgentId: uuid.nullable().optional(),
  addressStreet: z.string().max(255).nullable().optional(),
  addressCity: z.string().max(120).nullable().optional(),
  addressState: z.string().max(120).nullable().optional(),
  addressPincode: z.string().max(12).nullable().optional(),
  addressLat: z.number().min(-90).max(90).nullable().optional(),
  addressLng: z.number().min(-180).max(180).nullable().optional(),
});

export const orderStatusSchema = z.object({
  status: orderStatusEnumSchema,
});

export const deliveryOutcomeSchema = z.object({
  status: z.enum(['delivered', 'failed', 'skipped']),
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const orderListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: orderStatusEnumSchema.optional(),
  search: z.string().max(120).optional(),
});

export const adminOrderListQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: orderStatusEnumSchema.optional(),
  search: z.string().max(120).optional(),
});

export const orderIdParamSchema = z.object({
  id: uuid,
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type AdminCreateOrderInput = z.infer<typeof adminCreateOrderSchema>;
export type InstantDeliveryInput = z.infer<typeof instantDeliverySchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
export type DeliveryOutcomeInput = z.infer<typeof deliveryOutcomeSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
export type OrderIdParam = z.infer<typeof orderIdParamSchema>;
