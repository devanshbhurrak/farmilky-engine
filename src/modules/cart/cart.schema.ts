import { z } from 'zod';

export const addItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive().max(100),
});

export const updateItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
});

export const removeParamsSchema = z.object({
  productId: z.string().uuid(),
});

export const removeQuerySchema = z.object({
  variantId: z.string().uuid().optional(),
});

export type AddItemInput = z.infer<typeof addItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type RemoveParams = z.infer<typeof removeParamsSchema>;
export type RemoveQuery = z.infer<typeof removeQuerySchema>;
