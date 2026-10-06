import { z } from 'zod';

const uuid = z.string().uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const manifestSlotSchema = z.enum(['morning', 'evening']);

export const generateSchema = z.object({
  date: dateString.optional(),
  slot: z.enum(['morning', 'evening', 'both']).default('both'),
});

export const manifestQuerySchema = z.object({
  date: dateString.optional(),
  slot: manifestSlotSchema.optional(),
});

export const manifestHistoryQuerySchema = z.object({
  fromDate: dateString.optional(),
});

export const resequenceSchema = z.object({
  orderedEntryIds: z.array(uuid).min(1),
});

export const updateEntrySchema = z
  .object({
    // partial|extra are recorded in full on the subscription (quantity-correct
    // billing) and stored as delivered on the manifest entry itself, whose
    // status column only supports delivered|failed|skipped.
    status: z.enum(['delivered', 'partial', 'extra', 'failed', 'skipped']),
    notes: z.string().max(1000).optional(),
    failureReason: z.string().max(500).optional(),
    actualQuantity: z.number().positive('actualQuantity must be positive').optional(),
    reason: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'failed' && !v.failureReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'failureReason is required when status is failed',
        path: ['failureReason'],
      });
    }
    if ((v.status === 'partial' || v.status === 'extra') && v.actualQuantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'actualQuantity is required for partial/extra outcomes',
        path: ['actualQuantity'],
      });
    }
  });

export const manifestIdParamSchema = z.object({
  id: uuid,
});

export const manifestEntryParamSchema = z.object({
  id: uuid,
  entryId: uuid,
});

export type GenerateInput = z.infer<typeof generateSchema>;
export type ManifestQuery = z.infer<typeof manifestQuerySchema>;
export type ManifestHistoryQuery = z.infer<typeof manifestHistoryQuerySchema>;
export type ResequenceInput = z.infer<typeof resequenceSchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type ManifestIdParam = z.infer<typeof manifestIdParamSchema>;
export type ManifestEntryParam = z.infer<typeof manifestEntryParamSchema>;
