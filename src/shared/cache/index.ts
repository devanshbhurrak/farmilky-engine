import type { CacheAdapter } from './types.js';
import { RedisAdapter } from './redisAdapter.js';
import { MemoryAdapter } from './memoryAdapter.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type { CacheAdapter };

export let cache: CacheAdapter;

export function initCache(adapter?: CacheAdapter): CacheAdapter {
  if (adapter) {
    cache = adapter;
    return cache;
  }
  if (env.redisUrl) {
    cache = new RedisAdapter(env.redisUrl);
    logger.info('Cache: Redis');
  } else {
    cache = new MemoryAdapter();
    logger.warn('REDIS_URL not set — using in-memory cache (single-instance only)');
  }
  return cache;
}

export function getCache(): CacheAdapter {
  if (!cache) return initCache();
  return cache;
}
