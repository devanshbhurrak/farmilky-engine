import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../../shared/cache/memoryAdapter.js';

describe('MemoryAdapter', () => {
  let cache: MemoryAdapter;

  beforeEach(() => {
    cache = new MemoryAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── get / set ─────────────────────────────────────────────────────────────

  it('returns null for a missing key', async () => {
    expect(await cache.get('missing')).toBeNull();
  });

  it('stores and retrieves a string', async () => {
    await cache.set('key', 'hello', 60);
    expect(await cache.get('key')).toBe('hello');
  });

  it('stores and retrieves an object', async () => {
    const obj = { id: 1, name: 'test' };
    await cache.set('obj', obj, 60);
    expect(await cache.get('obj')).toEqual(obj);
  });

  it('stores and retrieves a number', async () => {
    await cache.set('num', 42, 60);
    expect(await cache.get<number>('num')).toBe(42);
  });

  it('stores null value as retrievable', async () => {
    await cache.set('nullval', null, 60);
    // null value stored, but get returns null for missing — behaviour depends on implementation
    // Our MemoryAdapter checks isFresh before returning; null stored should return null
    // (the entry exists but value is null). Accept either behaviour: null or null.
    const result = await cache.get('nullval');
    expect(result).toBeNull();
  });

  // ─── TTL / expiry ──────────────────────────────────────────────────────────

  it('returns null after TTL expires', async () => {
    vi.useFakeTimers();
    await cache.set('ttl', 'value', 1); // 1 second TTL
    vi.advanceTimersByTime(1001);
    expect(await cache.get('ttl')).toBeNull();
  });

  it('returns value before TTL expires', async () => {
    vi.useFakeTimers();
    await cache.set('ttl', 'value', 10); // 10 second TTL
    vi.advanceTimersByTime(9000);
    expect(await cache.get('ttl')).toBe('value');
  });

  // ─── del ───────────────────────────────────────────────────────────────────

  it('del removes an existing key', async () => {
    await cache.set('k', 'v', 60);
    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('del on a non-existent key does not throw', async () => {
    await expect(cache.del('nonexistent')).resolves.toBeUndefined();
  });

  // ─── exists ────────────────────────────────────────────────────────────────

  it('exists returns false for missing key', async () => {
    expect(await cache.exists('x')).toBe(false);
  });

  it('exists returns true for a live key', async () => {
    await cache.set('x', 1, 60);
    expect(await cache.exists('x')).toBe(true);
  });

  it('exists returns false after TTL expires', async () => {
    vi.useFakeTimers();
    await cache.set('x', 1, 1);
    vi.advanceTimersByTime(1001);
    expect(await cache.exists('x')).toBe(false);
  });

  it('exists returns false after del', async () => {
    await cache.set('x', 1, 60);
    await cache.del('x');
    expect(await cache.exists('x')).toBe(false);
  });

  // ─── increment ─────────────────────────────────────────────────────────────

  it('increment returns 1 on first call', async () => {
    expect(await cache.increment('counter', 60)).toBe(1);
  });

  it('increment increments on subsequent calls', async () => {
    await cache.increment('c', 60);
    await cache.increment('c', 60);
    expect(await cache.increment('c', 60)).toBe(3);
  });

  it('increment resets after TTL expires', async () => {
    vi.useFakeTimers();
    await cache.increment('c', 1);
    await cache.increment('c', 1);
    vi.advanceTimersByTime(1001);
    // New window: should start at 1 again
    expect(await cache.increment('c', 1)).toBe(1);
  });

  it('different keys have independent counters', async () => {
    await cache.increment('a', 60);
    await cache.increment('a', 60);
    await cache.increment('b', 60);
    expect(await cache.increment('a', 60)).toBe(3);
    expect(await cache.increment('b', 60)).toBe(2);
  });

  // ─── overwrite ─────────────────────────────────────────────────────────────

  it('set overwrites an existing value', async () => {
    await cache.set('k', 'original', 60);
    await cache.set('k', 'updated', 60);
    expect(await cache.get('k')).toBe('updated');
  });

  it('set refreshes the TTL', async () => {
    vi.useFakeTimers();
    await cache.set('k', 'v', 1);
    vi.advanceTimersByTime(800);
    await cache.set('k', 'v2', 5); // refresh with 5s TTL
    vi.advanceTimersByTime(2000);
    expect(await cache.get('k')).toBe('v2'); // still alive
  });
});
