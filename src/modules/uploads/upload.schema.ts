import { z } from 'zod';

export const deleteImageSchema = z.object({
  url: z.string().url('Invalid image URL'),
});

export type DeleteImageInput = z.infer<typeof deleteImageSchema>;
