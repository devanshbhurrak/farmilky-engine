import { createMiddleware } from 'hono/factory';
import type { ZodSchema } from 'zod';
import type { HonoEnv } from '../types/index.js';

export const validateBody = <T extends ZodSchema>(schema: T) =>
  createMiddleware<HonoEnv>(async (c, next) => {
    // An empty body is legitimate (e.g. cookie-based POST /users/refresh with
    // no JSON payload) and validates as {}. A non-empty body that fails to
    // parse is a 400 instead of silently validating as {}.
    let raw = '';
    try {
      raw = await c.req.text();
    } catch {
      return c.json({ success: false, message: 'Invalid request body' }, 400);
    }
    let json: unknown = {};
    if (raw.trim() !== '') {
      try {
        json = JSON.parse(raw);
      } catch {
        return c.json({ success: false, message: 'Invalid JSON body' }, 400);
      }
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      return c.json({ success: false, message: 'Validation error', errors: result.error.issues }, 422);
    }
    c.set('body', result.data);
    await next();
  });

export const validateQuery = <T extends ZodSchema>(schema: T) =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    const result = schema.safeParse(query);
    if (!result.success) {
      return c.json({ success: false, message: 'Validation error', errors: result.error.issues }, 422);
    }
    c.set('query', result.data);
    await next();
  });

export const validateParams = <T extends ZodSchema>(schema: T) =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const result = schema.safeParse(c.req.param());
    if (!result.success) {
      return c.json({ success: false, message: 'Validation error', errors: result.error.issues }, 422);
    }
    c.set('params', result.data);
    await next();
  });
