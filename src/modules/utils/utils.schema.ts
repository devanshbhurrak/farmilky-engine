import { z } from 'zod';

export const resolveMapsLinkSchema = z.object({
  url: z.string().url('url must be a valid URL'),
});

export type ResolveMapsLinkInput = z.infer<typeof resolveMapsLinkSchema>;
