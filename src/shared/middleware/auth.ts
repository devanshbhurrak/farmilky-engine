import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AuthUser, HonoEnv, JwtPayload } from '../types/index.js';

export const auth = createMiddleware<HonoEnv>(async (c, next) => {
  const cookieToken = getCookie(c, 'token');
  const header = c.req.header('Authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token = cookieToken || bearer;

  if (!token) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  try {
    const decoded = jwt.verify(token, env.jwtAccessSecret) as JwtPayload;
    const user: AuthUser = { id: decoded.userId, tenantId: decoded.tenantId, role: decoded.role };
    c.set('user', user);
    await next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return c.json({ success: false, message: 'Token expired' }, 401);
    }
    return c.json({ success: false, message: 'Invalid token' }, 401);
  }
});
