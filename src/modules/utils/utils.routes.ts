import { Hono } from 'hono';
import type { HonoEnv } from '../../shared/types/index.js';
import { validateBody } from '../../shared/middleware/validate.js';
import { UtilsController } from './utils.controller.js';
import { resolveMapsLinkSchema } from './utils.schema.js';

export const utilsRoutes = new Hono<HonoEnv>();

utilsRoutes.post('/resolve-maps-link', validateBody(resolveMapsLinkSchema), UtilsController.resolveMapsLink);
