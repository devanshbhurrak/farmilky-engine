import { S3Client } from "@aws-sdk/client-s3";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { logger } from "../utils/logger.js";

/**
 * Cloudflare R2 endpoint construction.
 *
 * Prefers the explicit `R2_ENDPOINT` env var when provided. Otherwise builds
 * the endpoint from `R2_ACCOUNT_ID`. Falls back to `R2_ENDPOINT` parsing as a
 * last resort so that configurations that only set `R2_ENDPOINT` still work.
 */
const rawEndpoint = process.env.R2_ENDPOINT?.trim() || "";
const rawAccountId = process.env.R2_ACCOUNT_ID?.trim() || "";

const accountId = rawAccountId
  || (rawEndpoint ? rawEndpoint.replace(/^https?:\/\//, "").split(".")[0] : "");

const bucketName = process.env.R2_BUCKET_NAME?.trim();
const publicUrl = process.env.R2_PUBLIC_URL?.trim();

const r2Endpoint = rawEndpoint
  || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

if (!accountId || !bucketName || !publicUrl) {
  logger.warn(
    "[r2] R2 environment variables not fully configured — image uploads will fail until R2_ACCOUNT_ID, R2_BUCKET_NAME and R2_PUBLIC_URL are set.",
  );
}

export const r2Client = new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

export const R2_BUCKET_NAME = bucketName;
export const R2_PUBLIC_URL = publicUrl ? publicUrl.replace(/\/$/, "") : "";

export const R2_KEY_PREFIX = "products";

export function buildR2Key(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${R2_KEY_PREFIX}/${Date.now()}-${random}-${safeName}`;
}

export function buildPublicUrl(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
}

export function extractKeyFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const base = R2_PUBLIC_URL.replace(/\/$/, "");
  if (!url.startsWith(`${base}/`)) return null;
  return url.slice(base.length + 1);
}

export function isR2Url(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  return url.startsWith(`${R2_PUBLIC_URL}/`);
}

export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
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

export async function uploadImage(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new R2Error('Invalid image buffer provided.', 400);
  }

  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase())) {
    throw new R2Error(
      `Unsupported image type: ${contentType}. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}`,
      400,
    );
  }

  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new R2Error(
      `Image size exceeds ${MAX_IMAGE_SIZE / (1024 * 1024)} MB limit.`,
      400,
    );
  }

  const key = buildR2Key(filename);

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

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
  if (!key || typeof key !== "string") {
    throw new R2Error("Invalid object key provided.", 400);
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  try {
    const response = await r2Client.send(command);

    if (!response.Body) {
      throw new R2Error("Object not found in storage.", 404);
    }

    // Convert the SDK stream to a Buffer.
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    return {
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      contentType: response.ContentType ?? "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof R2Error) throw error;
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      err.name === "NoSuchKey" ||
      err.name === "NotFound" ||
      err.$metadata?.httpStatusCode === 404
    ) {
      throw new R2Error("Object not found in storage.", 404);
    }
    logger.error({ err: error }, "[r2] Get object failed");
    throw new R2Error("Failed to retrieve image from storage.", 500);
  }
}

export async function deleteImage(key: string): Promise<void> {
  if (!key || typeof key !== 'string') {
    throw new R2Error('Invalid image key provided.', 400);
  }

  try {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      }),
    );
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
