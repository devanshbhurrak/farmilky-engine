import type { CacheAdapter } from './types.js';
import { MemoryAdapter } from './memoryAdapter.js';
import { logger } from '../utils/logger.js';

export type { CacheAdapter };

export let cache: CacheAdapter;

/**
 * Defaults to the in-memory adapter. Node bootstrap can pass a Redis adapter;
 * the Worker never imports Redis so ioredis stays out of the Worker bundle.
 */
export function initCache(adapter?: CacheAdapter): CacheAdapter {
  cache = adapter ?? new MemoryAdapter();
  if (adapter) logger.info('Cache: custom adapter');
  else logger.info('Cache: in-memory (per isolate)');
  return cache;
}

export function getCache(): CacheAdapter {
  if (!cache) return initCache();
  return cache;
}
