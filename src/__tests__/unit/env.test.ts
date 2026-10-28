import { afterEach, describe, expect, it } from 'vitest';
import { validateEnv } from '../../shared/config/env.js';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  CRON_SECRET: process.env.CRON_SECRET,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('environment validation', () => {
  it('requires an explicit origin allowlist in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://localhost/farmilky';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.CRON_SECRET = 'test-cron-secret-long-enough';
    delete process.env.ALLOWED_ORIGINS;

    expect(() => validateEnv()).toThrow('ALLOWED_ORIGINS must be configured');
  });

  it('rejects wildcard origins when credentials are enabled', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgres://localhost/farmilky';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.CRON_SECRET = 'test-cron-secret-long-enough';
    process.env.ALLOWED_ORIGINS = '*';

    expect(() => validateEnv()).toThrow('ALLOWED_ORIGINS cannot contain "*"');
  });
});
