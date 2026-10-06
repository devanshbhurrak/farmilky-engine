import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const createHolidaySchema = z.object({
  date: dateString,
  name: z.string().min(1),
  isActive: z.boolean().default(true),
});

export const updateHolidaySchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const holidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const holidayIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type HolidayListQuery = z.infer<typeof holidayListQuerySchema>;
export type HolidayIdParam = z.infer<typeof holidayIdParamSchema>;
