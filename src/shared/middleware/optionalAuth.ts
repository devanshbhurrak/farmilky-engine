import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AuthUser, HonoEnv, JwtPayload } from '../types/index.js';

// Like `auth`, but does not reject unauthenticated requests. When a valid
// token is present the user context is set so downstream handlers can use it;
// when there is no token (or an invalid one) the request continues without a
// user context. Use this on public endpoints that should also work for
// authenticated users (e.g. the public product catalogue called from the admin
// portal where the tenant can be derived from the JWT instead of a slug).
export const optionalAuth = createMiddleware<HonoEnv>(async (c, next) => {
  const cookieToken = getCookie(c, 'token');
  const header = c.req.header('Authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token = cookieToken || bearer;

  if (token) {
    try {
      const decoded = jwt.verify(token, env.jwtAccessSecret) as JwtPayload;
      const user: AuthUser = { id: decoded.userId, tenantId: decoded.tenantId, role: decoded.role };
      c.set('user', user);
    } catch {
      // Invalid/expired token — proceed as an unauthenticated public request.
    }
  }

  await next();
});
