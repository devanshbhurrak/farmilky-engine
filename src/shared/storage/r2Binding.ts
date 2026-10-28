import type { StorageAdapter, StoredObject } from './types.js';

/**
 * Minimal structural type for the Cloudflare R2 binding. Keeping it local avoids
 * a hard dependency on @cloudflare/workers-types in the Node build.
 */
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<
    | {
        arrayBuffer(): Promise<ArrayBuffer>;
        httpMetadata?: { contentType?: string };
      }
    | null
  >;
  delete(key: string): Promise<void>;
}

export function createR2BindingStorage(bucket: R2BucketLike): StorageAdapter {
  return {
    async put(key, body, contentType): Promise<void> {
      await bucket.put(key, body instanceof Uint8Array ? body : new Uint8Array(body), {
        httpMetadata: {
          contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    },

    async get(key): Promise<StoredObject> {
      const object = await bucket.get(key);
      if (!object) {
        const err = new Error('Object not found') as Error & { statusCode?: number };
        err.statusCode = 404;
        throw err;
      }
      return {
        body: await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      };
    },

    async delete(key): Promise<void> {
      await bucket.delete(key);
    },
  };
}
