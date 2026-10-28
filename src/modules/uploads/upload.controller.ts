import type { Context } from 'hono';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { ok } from '../../shared/utils/response.js';
import {
  uploadImage,
  deleteImageByUrl,
  getObjectByKey,
  extractKeyFromUrl,
  isR2Url,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from '../../shared/storage/r2.js';

export const uploadProductImage = async (c: Context) => {
  const body = await c.req.parseBody();
  const file = body['image'];

  if (!file || !(file as File)?.arrayBuffer) {
    throw new AppError('No image file provided', 400);
  }

  const uploadedFile = file as File;

  if (!ALLOWED_IMAGE_TYPES.has(uploadedFile.type)) {
    throw new AppError(
      `Unsupported image type: ${uploadedFile.type}. Allowed: JPEG, PNG, WebP, GIF.`,
      400,
    );
  }

  const arrayBuffer = await uploadedFile.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new AppError(`Image size exceeds ${MAX_IMAGE_SIZE / (1024 * 1024)} MB limit`, 400);
  }

  const result = await uploadImage(buffer, uploadedFile.name, uploadedFile.type);

  return ok(c, { url: result.url, key: result.key });
};

export const serveImage = async (c: Context) => {
  const url = c.req.query('url');

  if (!url) {
    throw new AppError('Image URL is required', 400);
  }

  const key = extractKeyFromUrl(url);
  if (!key) {
    throw new AppError('Invalid image URL', 400);
  }

  try {
    const { body, contentType } = await getObjectByKey(key);
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('Content-Disposition', 'inline');
    return c.body(body);
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 404) {
      throw new AppError('Image not found', 404);
    }
    throw new AppError(e.message ?? 'Failed to serve image', e.statusCode ?? 500);
  }
};

export const deleteProductImage = async (c: Context) => {
  const body = c.get('body') as { url: string };
  const url = body.url;

  if (!url) {
    throw new AppError('Image URL is required', 400);
  }

  if (!isR2Url(url)) {
    throw new AppError('Only R2-hosted images can be deleted via this endpoint', 400);
  }

  await deleteImageByUrl(url);

  return ok(c, { message: 'Image deleted successfully' });
};
