import { z } from 'zod';

export const unitSchema = z.enum(['L', 'ml', 'kg', 'g', 'unit']);

export const categorySchema = z.enum(['milk', 'ghee', 'paneer', 'curd', 'butter', 'cheese', 'other']);

export const variantSchema = z.object({
  label: z.string().min(1),
  quantity: z.number().positive(),
  unit: unitSchema,
  price: z.number().min(0),
  discountedPrice: z.number().min(0).optional(),
  stock: z.number().int().min(0).default(0),
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const updateVariantSchema = variantSchema.partial().extend({
  id: z.string().uuid().optional(),
});

export const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: categorySchema,
  basePrice: z.number().min(0).optional(),
  unit: unitSchema.default('L'),
  fatContent: z.number().min(0).optional(),
  stock: z.number().int().min(0).default(0),
  imageUrl: z.string().optional(),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  variants: z.array(variantSchema).optional(),
});

export const updateProductSchema = createProductSchema.partial().extend({
  variants: z.array(updateVariantSchema).optional(),
});

export const productListQuerySchema = z.object({
  slug: z.string().min(1).optional(),
  category: categorySchema.optional(),
  search: z.string().max(120).optional(),
  availability: z.enum(['available', 'unavailable']).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const productIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type VariantInput = z.infer<typeof variantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductIdParam = z.infer<typeof productIdParamSchema>;
