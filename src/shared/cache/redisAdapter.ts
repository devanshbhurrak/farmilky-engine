import { Redis } from 'ioredis';
import type { CacheAdapter } from './types.js';

export class RedisAdapter implements CacheAdapter {
  private client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds > 0) {
      await this.client.set(key, raw, 'EX', Math.max(1, Math.floor(ttlSeconds)));
    } else {
      await this.client.set(key, raw);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, Math.max(1, Math.floor(ttlSeconds)));
    }
    return count;
  }

  async setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const result = await this.client.set(
      key,
      raw,
      'EX',
      Math.max(1, Math.floor(ttlSeconds)),
      'NX',
    );
    return result === 'OK';
  }

  async disconnect(): Promise<void> {
    this.client.disconnect();
  }
}
