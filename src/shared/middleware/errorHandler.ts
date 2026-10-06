import { ZodError } from 'zod';
import type { Context } from 'hono';

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
  console.error(JSON.stringify({ level: 'error', path, err: String(err?.stack ?? err) }));
  if (err instanceof AppError) {
    return c.json({ success: false, message: err.message, code: err.code }, err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json({ success: false, message: 'Validation error', errors: err.issues }, 422);
  }
  return c.json({ success: false, message: 'Internal server error' }, 500);
};
