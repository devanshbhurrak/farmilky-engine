import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { isCrossSite, isProd } from '../../shared/config/env.js';
import { created, ok, paginated } from '../../shared/utils/response.js';
import type { AuthUser, HonoEnv } from '../../shared/types/index.js';
import type {
  AdminCreateUserInput,
  AdminListQuery,
  AdminUpdateUserInput,
  CustomerRegisterInput,
  DeliveryConfigInput,
  LoginInput,
  UpdateProfileInput,
  UserAdjustmentInput,
  UserIdParam,
} from './user.schema.js';
import { AuthService, UserService } from './user.service.js';
import { transactionService } from '../transactions/transaction.service.js';

function baseCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: (isCrossSite() ? 'none' : 'lax') as 'none' | 'lax',
    maxAge,
    path: '/',
  };
}

function setAuthCookies(c: Context<HonoEnv>, accessToken: string, refreshToken: string) {
  setCookie(c, 'token', accessToken, baseCookieOptions(15 * 60));
  setCookie(c, 'refreshToken', refreshToken, baseCookieOptions(30 * 24 * 3600));
}

function getRefreshRaw(c: Context<HonoEnv>): string {
  const fromCookie = getCookie(c, 'refreshToken');
  if (fromCookie) return fromCookie;
  const body = c.get('body') as { refreshToken?: string } | undefined;
  if (body?.refreshToken) return body.refreshToken;
  return '';
}

export async function register(c: Context<HonoEnv>) {
  const body = c.get('body') as CustomerRegisterInput;
  const headerSlug = c.req.header('x-tenant-slug');
  const result = await AuthService.register(body, headerSlug);
  setAuthCookies(c, result.accessToken, result.refreshToken);
  return created(c, result);
}

export async function login(c: Context<HonoEnv>) {
  const body = c.get('body') as LoginInput;
  const headerSlug = c.req.header('x-tenant-slug');
  const result = await AuthService.login(body, headerSlug);
  setAuthCookies(c, result.accessToken, result.refreshToken);
  return ok(c, result);
}

export async function logout(c: Context<HonoEnv>) {
  const raw = getRefreshRaw(c);
  await AuthService.logout(raw);
  deleteCookie(c, 'token', { path: '/' });
  deleteCookie(c, 'refreshToken', { path: '/' });
  return ok(c, { loggedOut: true });
}

export async function refresh(c: Context<HonoEnv>) {
  const raw = getRefreshRaw(c);
  const result = await AuthService.refresh(raw);
  setAuthCookies(c, result.accessToken, result.refreshToken);
  return ok(c, result);
}

export async function getProfile(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const profile = await UserService.getProfile(user.tenantId, user.id);
  return ok(c, profile);
}

export async function updateProfile(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as UpdateProfileInput;
  const profile = await UserService.updateProfile(user.tenantId, user.id, body);
  return ok(c, profile);
}

export async function listAdminUsers(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const query = c.get('query') as AdminListQuery;
  const { items, meta } = await UserService.listAdmin(user.tenantId, query);
  return paginated(c, items, meta);
}

export async function createAdminUser(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const body = c.get('body') as AdminCreateUserInput;
  const createdUser = await UserService.createAdminUser(user.tenantId, user.id, body);
  return created(c, createdUser);
}

export async function getAdminUser(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as UserIdParam;
  const detail = await UserService.getAdminDetail(user.tenantId, params.id);
  return ok(c, detail);
}

export async function updateAdminUser(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as UserIdParam;
  const body = c.get('body') as AdminUpdateUserInput;
  const updated = await UserService.updateAdminUser(user.tenantId, params.id, body);
  return ok(c, updated);
}

export async function updateDeliveryConfig(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as UserIdParam;
  const body = c.get('body') as DeliveryConfigInput;
  const updated = await UserService.updateDeliveryConfig(user.tenantId, params.id, body);
  return ok(c, updated);
}

export async function createUserAdjustment(c: Context<HonoEnv>) {
  const user = c.get('user') as AuthUser;
  const params = c.get('params') as UserIdParam;
  const body = c.get('body') as UserAdjustmentInput;

  const entryType = body.type === 'credit_adjustment' ? 'credit' : 'debit';
  const txn = await transactionService.createTransaction({
    tenantId: user.tenantId,
    partyType: 'customer',
    partyId: params.id,
    txnType: body.type,
    entryType,
    amount: body.amount,
    effectiveDate: body.date,
    description: `${body.type.replace('_', ' ').toLowerCase()}`,
    notes: body.notes ?? null,
    createdById: user.id,
  });

  return created(c, txn);
}
