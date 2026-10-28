import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getStorage, hasStorage } from './types.js';

export { configureStorage, hasStorage } from './types.js';
export type { StorageAdapter } from './types.js';

export function r2PublicUrl(): string {
  return (env.r2PublicUrl ?? '').replace(/\/$/, '');
}

export const R2_KEY_PREFIX = 'products';

export function buildR2Key(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${env.r2KeyPrefix}/${Date.now()}-${random}-${safeName}`;
}

export function buildPublicUrl(key: string): string {
  const base = r2PublicUrl();
  if (!base) throw new R2Error('R2_PUBLIC_URL is not configured', 500);
  return `${base}/${key}`;
}

export function extractKeyFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const base = r2PublicUrl();
  if (!base || !url.startsWith(`${base}/`)) return null;
  return url.slice(base.length + 1);
}

export function isR2Url(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const base = r2PublicUrl();
  return base.length > 0 && url.startsWith(`${base}/`);
}

export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface UploadResult {
  key: string;
  url: string;
}

export class R2Error extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'R2Error';
    this.statusCode = statusCode;
  }
}

function assertStorage(): void {
  if (!hasStorage()) {
    logger.warn('[r2] Storage adapter is not configured — image operations will fail');
    throw new R2Error('Image storage is not configured', 500);
  }
}

export async function uploadImage(
  buffer: Uint8Array,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  if (!buffer || buffer.byteLength === 0) {
    throw new R2Error('Invalid image buffer provided.', 400);
  }

  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase())) {
    throw new R2Error(
      `Unsupported image type: ${contentType}. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}`,
      400,
    );
  }

  if (buffer.byteLength > MAX_IMAGE_SIZE) {
    throw new R2Error(`Image size exceeds ${MAX_IMAGE_SIZE / (1024 * 1024)} MB limit.`, 400);
  }

  assertStorage();
  const key = buildR2Key(filename);

  try {
    await getStorage().put(key, buffer, contentType);
    return { key, url: buildPublicUrl(key) };
  } catch (error) {
    if (error instanceof R2Error) throw error;
    logger.error({ err: error }, '[r2] Upload failed');
    throw new R2Error('Failed to upload image to storage.', 500);
  }
}

export async function getObjectByKey(key: string): Promise<{
  body: ArrayBuffer;
  contentType: string;
}> {
  if (!key || typeof key !== 'string') {
    throw new R2Error('Invalid object key provided.', 400);
  }

  assertStorage();

  try {
    return await getStorage().get(key);
  } catch (error) {
    if (error instanceof R2Error) throw error;
    const err = error as { statusCode?: number; name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.statusCode === 404 || err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      throw new R2Error('Object not found in storage.', 404);
    }
    logger.error({ err: error }, '[r2] Get object failed');
    throw new R2Error('Failed to retrieve image from storage.', 500);
  }
}

export async function deleteImage(key: string): Promise<void> {
  if (!key || typeof key !== 'string') {
    throw new R2Error('Invalid image key provided.', 400);
  }

  assertStorage();

  try {
    await getStorage().delete(key);
  } catch (error) {
    logger.error({ err: error }, '[r2] Delete failed');
    throw new R2Error('Failed to delete image from storage.', 500);
  }
}

export async function deleteImageByUrl(url: string): Promise<void> {
  const key = extractKeyFromUrl(url);
  if (!key) {
    throw new R2Error('Not an R2 URL', 400);
  }
  await deleteImage(key);
}
