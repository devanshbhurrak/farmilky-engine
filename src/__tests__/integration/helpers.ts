import { beforeAll, describe, expect, it } from 'vitest';

// Integration tests require a real PostgreSQL database with migrations applied:
//   DATABASE_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... npm test
// They are skipped in environments without a database.
const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET,
);
const describeDb = hasDb ? describe : describe.skip;

export function dbOnly(name: string, fn: () => void): void {
  describeDb(name, fn);
}

export function tenantSlug(): string {
  return `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

describe('integration harness', () => {
  it('runs unit suite without a database', () => {
    expect(true).toBe(true);
  });
});

beforeAll(() => {
  if (hasDb) {
    process.env.NODE_ENV = 'test';
  }
});
