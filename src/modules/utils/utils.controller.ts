import type { Context } from 'hono';
import { resolveMapsLink } from './utils.service.js';
import { ok } from '../../shared/utils/response.js';

export const UtilsController = {
  async resolveMapsLink(c: Context) {
    const body = c.get('body') as { url: string };
    const coords = await resolveMapsLink(body.url);
    return ok(c, coords);
  },
};
