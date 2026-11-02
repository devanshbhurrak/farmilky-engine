import { ZodError } from 'zod';
import type { Context } from 'hono';
import { env } from '../config/env.js';

export class AppError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const onError = (err: Error, c: Context) => {
  const path = c.req.path;
  console.error(JSON.stringify({ level: 'error', path, message: err?.message, stack: err?.stack ?? String(err) }));

  const origin = c.req.header('origin');
  if (origin) {
    const allowed = env.allowedOrigins.map((o) => o.trim().replace(/\/$/, ''));
    const reqOrigin = origin.trim().replace(/\/$/, '');
    if (allowed.includes(reqOrigin) || (!allowed.length && env.nodeEnv !== 'production') || allowed.includes('*')) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (err instanceof AppError) {
    return c.json({ success: false, message: err.message, code: err.code }, err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json({ success: false, message: 'Validation error', errors: err.issues }, 422);
  }
  return c.json({ success: false, message: err?.message || 'Internal server error' }, 500);
};
