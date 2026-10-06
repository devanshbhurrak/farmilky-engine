import { describe, expect, it } from 'vitest';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';

describe('parsePagination', () => {
  it('defaults: page=1, limit=20, sortOrder=desc', () => {
    const result = parsePagination({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortOrder).toBe('desc');
  });

  it('parses string page and limit', () => {
    const result = parsePagination({ page: '3', limit: '10' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20); // (3-1)*10
  });

  it('parses numeric page and limit', () => {
    const result = parsePagination({ page: 2, limit: 50 });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(50);
  });

  it('enforces minimum page of 1', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1);
    expect(parsePagination({ page: '-5' }).page).toBe(1);
  });

  it('enforces minimum limit of 1 for negative values', () => {
    // Negative values: Math.max(1, -100) = 1
    expect(parsePagination({ limit: '-100' }).limit).toBe(1);
  });

  it('limit=0 falls back to defaultLimit (treated as missing)', () => {
    // Number('0') = 0 which is falsy, so || defaultLimit kicks in → 20
    expect(parsePagination({ limit: '0' }).limit).toBe(20);
  });

  it('caps limit at maxLimit (default 100)', () => {
    expect(parsePagination({ limit: '200' }).limit).toBe(100);
    expect(parsePagination({ limit: '1000' }).limit).toBe(100);
  });

  it('respects custom maxLimit', () => {
    const result = parsePagination({ limit: '60' }, { maxLimit: 50 });
    expect(result.limit).toBe(50);
  });

  it('respects custom defaultLimit', () => {
    const result = parsePagination({}, { defaultLimit: 5 });
    expect(result.limit).toBe(5);
  });

  it('handles NaN gracefully (falls back to defaults)', () => {
    const result = parsePagination({ page: 'abc', limit: 'xyz' });
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('sorts asc when explicitly requested', () => {
    expect(parsePagination({ sortOrder: 'asc' }).sortOrder).toBe('asc');
    expect(parsePagination({ sortOrder: 'ASC' }).sortOrder).toBe('asc');
  });

  it('sorts desc for any non-asc value', () => {
    expect(parsePagination({ sortOrder: 'desc' }).sortOrder).toBe('desc');
    expect(parsePagination({ sortOrder: 'random' }).sortOrder).toBe('desc');
    expect(parsePagination({ sortOrder: '' }).sortOrder).toBe('desc');
  });

  it('allows sortBy when in allowedSortFields', () => {
    const result = parsePagination(
      { sortBy: 'createdAt' },
      { allowedSortFields: ['createdAt', 'name'] },
    );
    expect(result.sortBy).toBe('createdAt');
  });

  it('rejects sortBy when not in allowedSortFields', () => {
    const result = parsePagination(
      { sortBy: 'password' },
      { allowedSortFields: ['createdAt', 'name'] },
    );
    expect(result.sortBy).toBeUndefined();
  });

  it('allows any sortBy when allowedSortFields is not specified', () => {
    const result = parsePagination({ sortBy: 'anything' });
    expect(result.sortBy).toBe('anything');
  });

  it('computes offset correctly for page 1', () => {
    expect(parsePagination({ page: 1, limit: 20 }).offset).toBe(0);
  });

  it('computes offset correctly for later pages', () => {
    expect(parsePagination({ page: 5, limit: 10 }).offset).toBe(40);
  });
});

describe('buildMeta', () => {
  it('builds correct meta for first page', () => {
    const meta = buildMeta(95, 1, 20);
    expect(meta.total).toBe(95);
    expect(meta.page).toBe(1);
    expect(meta.limit).toBe(20);
    expect(meta.totalPages).toBe(5);
  });

  it('totalPages rounds up', () => {
    expect(buildMeta(21, 1, 20).totalPages).toBe(2);
    expect(buildMeta(20, 1, 20).totalPages).toBe(1);
    expect(buildMeta(1, 1, 20).totalPages).toBe(1);
  });

  it('totalPages = 1 when total = 0', () => {
    expect(buildMeta(0, 1, 20).totalPages).toBe(1);
  });

  it('exact multiple has no extra page', () => {
    expect(buildMeta(100, 1, 20).totalPages).toBe(5);
  });
});
