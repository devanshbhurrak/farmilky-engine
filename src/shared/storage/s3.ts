import { S3Client } from '@aws-sdk/client-s3';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import type { StorageAdapter, StoredObject } from './types.js';

function endpoint(): string {
  if (env.r2Endpoint) return env.r2Endpoint;
  const accountId = env.r2AccountId;
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '';
}

/**
 * S3-compatible storage for Node deployments (and local dev against R2).
 * Imported lazily by bootstrap.ts so Workers never bundle the AWS SDK.
 */
export function createS3Storage(): StorageAdapter {
  const bucket = env.r2BucketName;
  if (!bucket) throw new Error('R2_BUCKET_NAME is required for S3 storage');

  const client = new S3Client({
    region: 'auto',
    endpoint: endpoint(),
    credentials: {
      accessKeyId: env.r2AccessKeyId ?? '',
      secretAccessKey: env.r2SecretAccessKey ?? '',
    },
  });

  return {
    async put(key, body, contentType): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(body),
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    },

    async get(key): Promise<StoredObject> {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error('Object not found');
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      return {
        body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
        contentType: response.ContentType ?? 'application/octet-stream',
      };
    },

    async delete(key): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
