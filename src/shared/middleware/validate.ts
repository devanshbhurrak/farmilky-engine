import { createMiddleware } from 'hono/factory';
import type { ZodSchema } from 'zod';
import type { HonoEnv } from '../types/index.js';

export const validateBody = <T extends ZodSchema>(schema: T) =>
  createMiddleware<HonoEnv>(async (c, next) => {
    let json: unknown = {};
    try {
      json = await c.req.json();
    } catch {
      json = {};
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
