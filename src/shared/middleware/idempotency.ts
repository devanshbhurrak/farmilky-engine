import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HonoEnv } from '../types/index.js';
import { getCache } from '../cache/index.js';
import { sha256 } from '../utils/crypto.js';

const TTL_SECONDS = 8;
const CACHEABLE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// Deduplicates retried mutations for 8s. Key: sha256 of
// tenant|user|method|path+query|body. Only 2xx responses are replayed —
// client/result errors (4xx) are never cached so a corrected retry executes.
// Skips gracefully when no authenticated user is present. Note: without Redis
// this is per-process memory; multi-instance deployments need REDIS_URL for
// cross-instance dedupe, and there is no distributed lock (simultaneous
// duplicate requests may both execute — clients should also send retry-safe
// payloads for money-moving endpoints).
export const idempotency = createMiddleware<HonoEnv>(async (c, next) => {
  if (!CACHEABLE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const user = c.get('user');
  if (!user?.tenantId || !user?.id) {
    await next();
    return;
  }
  let bodyText = '';
  try {
    bodyText = JSON.stringify(await c.req.json());
  } catch {
    bodyText = '';
  }
  const url = new URL(c.req.url);
  const pathWithQuery = `${c.req.path}${url.search}`;
  const key = `idem:${sha256(`${user.tenantId}|${user.id}|${c.req.method}|${pathWithQuery}|${bodyText}`)}`;
  const cache = getCache();
  const cached = await cache.get<{ status: number; body: unknown }>(key);
  if (cached) {
    return c.json(cached.body, cached.status as ContentfulStatusCode);
  }

  await next();

  const status = c.res.status;
  if (status >= 200 && status < 300) {
    try {
      const resBody = await c.res.clone().json();
      await cache.set(key, { status, body: resBody }, TTL_SECONDS);
    } catch {
      // Non-JSON responses are not cached
    }
  }
});
