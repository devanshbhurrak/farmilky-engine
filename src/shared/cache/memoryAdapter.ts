import { LRUCache } from 'lru-cache';
import type { CacheAdapter } from './types.js';

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryAdapter implements CacheAdapter {
  private store = new LRUCache<string, Entry>({ max: 5000 });
  private counters = new Map<string, { count: number; expiresAt: number }>();

  private isFresh(expiresAt: number): boolean {
    return Date.now() < expiresAt;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (!this.isFresh(entry.expiresAt)) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const cur = this.counters.get(key);
    if (!cur || now >= cur.expiresAt) {
      const fresh = { count: 1, expiresAt: now + Math.max(1, ttlSeconds) * 1000 };
      this.counters.set(key, fresh);
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }
}
