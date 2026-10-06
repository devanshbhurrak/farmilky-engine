import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { isCrossSite, isProd } from '../../shared/config/env.js';
import { created, ok } from '../../shared/utils/response.js';
import type { AuthUser, HonoEnv } from '../../shared/types/index.js';
import type { RegisterTenantInput, UpdateTenantInput } from './tenant.schema.js';
import { TenantService } from './tenant.service.js';

function baseCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: (isCrossSite() ? 'none' : 'lax') as 'none' | 'lax',
    maxAge,
    path: '/',
  };
}

export async function registerTenant(c: Context<HonoEnv>) {
  const body = c.get('body') as RegisterTenantInput;
  const result = await TenantService.register(body);

  setCookie(c, 'token', result.accessToken, baseCookieOptions(15 * 60));
  setCookie(c, 'refreshToken', result.refreshToken, baseCookieOptions(30 * 24 * 3600));

  return created(c, result);
}

export async function getMe(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const tenant = await TenantService.getById(user.tenantId);
  return ok(c, tenant);
}

export async function updateMe(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as UpdateTenantInput;
  const tenant = await TenantService.update(user.tenantId, body);
  return ok(c, tenant);
}
