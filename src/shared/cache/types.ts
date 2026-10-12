export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  increment(key: string, ttlSeconds: number): Promise<number>;
  /**
   * Atomic set-if-absent (distributed lock primitive). Resolves true when the
   * key was set (lock acquired), false when it already exists (locked).
   */
  setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
}
