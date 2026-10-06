import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { PaginationMeta } from '../types/index.js';

export const ok = (c: Context, data: unknown, status: ContentfulStatusCode = 200) =>
  c.json({ success: true, data }, status);

export const created = (c: Context, data: unknown) =>
  c.json({ success: true, data }, 201);

export const paginated = (c: Context, data: unknown, meta: PaginationMeta) =>
  c.json({ success: true, data, meta });

export const fail = (c: Context, message: string, status: ContentfulStatusCode = 400, extra?: Record<string, unknown>) =>
  c.json({ success: false, message, ...extra }, status);
