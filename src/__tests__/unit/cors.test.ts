import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
});

describe('credentialed CORS policy', () => {
  it('allows local development origins without a wildcard credential header', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOWED_ORIGINS;

    const response = await createApp().request('/api/users/login', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
      },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('only reflects explicitly configured production origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://portal.example';

    const allowed = await createApp().request('/api/users/login', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://portal.example',
        'access-control-request-method': 'POST',
      },
    });
    const rejected = await createApp().request('/api/users/login', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://untrusted.example',
        'access-control-request-method': 'POST',
      },
    });

    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://portal.example');
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
  });
});
