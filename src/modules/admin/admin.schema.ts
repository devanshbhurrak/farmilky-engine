import { z } from 'zod';

export const deliveryPerformanceQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export type DeliveryPerformanceQuery = z.infer<typeof deliveryPerformanceQuerySchema>;
