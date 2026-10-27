import { Hono } from 'hono';
import { adminOnly } from '../../shared/middleware/adminOnly.js';
import { auth } from '../../shared/middleware/auth.js';
import { createLimiter } from '../../shared/middleware/rateLimiter.js';
import { validateBody } from '../../shared/middleware/validate.js';
import { uploadProductImage, deleteProductImage } from './upload.controller.js';
import { deleteImageSchema } from './upload.schema.js';

const uploadLimiter = createLimiter(30, 15 * 60 * 1000);

export const uploadRoutes = new Hono();

uploadRoutes.use('*', auth, adminOnly, uploadLimiter);
uploadRoutes.post('/image', uploadProductImage);
uploadRoutes.delete('/image', validateBody(deleteImageSchema), deleteProductImage);
