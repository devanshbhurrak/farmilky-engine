import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { env } from '../../shared/config/env.js';
import { getCache } from '../../shared/cache/index.js';
import { generateTokenId, sha256 } from '../../shared/utils/crypto.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { DELIVERY_ROLES } from '../../shared/constants/permissions.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import type {
  AdminCreateUserInput,
  AdminListQuery,
  AdminUpdateUserInput,
  CustomerRegisterInput,
  DeliveryConfigInput,
  LoginInput,
  UpdateProfileInput,
} from './user.schema.js';
import { findTenantBySlug } from '../tenants/tenant.repository.js';
import {
  countUsers,
  createRefreshToken,
  createUser,
  ensureAgentProfile,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  findValidRefreshTokenByHash,
  getActiveSubscriptions,
  getRecentOrders,
  listUsersWithCounts,
  revokeRefreshTokenByHash,
  revokeRefreshTokenById,
  updateUserById,
} from './user.repository.js';

const REFRESH_TTL_SECONDS = 30 * 24 * 3600;

function signAccessToken(userId: string, tenantId: string, role: string): string {
  return jwt.sign({ userId, tenantId, role }, env.jwtAccessSecret, { expiresIn: '15m' });
}

function sanitizeUser<T extends Record<string, unknown>>(user: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _omitted, ...rest } = user;
  void _omitted;
  return rest;
}

async function issueTokenPair(
  userId: string,
  tenantId: string,
  role: string,
  dbOrTx: DBOrTx,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken(userId, tenantId, role);
  const raw = generateTokenId();
  const hash = sha256(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await createRefreshToken({ tenantId, userId, tokenHash: hash, expiresAt }, dbOrTx);
  await getCache().set(`refresh:${hash}`, { userId, tenantId }, REFRESH_TTL_SECONDS);
  return { accessToken, refreshToken: raw };
}

function resolveTenantSlug(bodySlug?: string, headerSlug?: string): string | undefined {
  return bodySlug ?? headerSlug;
}

// Sets the Postgres session variable that RLS policies read.
// Must be called inside a transaction (is_local=true → auto-resets on commit/rollback).
async function setRlsTenantContext(tenantId: string, dbOrTx: DBOrTx): Promise<void> {
  await dbOrTx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}

export class AuthService {
  static async register(
    input: CustomerRegisterInput,
    headerSlug?: string,
    tx?: DrizzleTx,
  ) {
    const run = async (dbOrTx: DBOrTx) => {
      const slug = resolveTenantSlug(input.tenantSlug, headerSlug);
      if (!slug) throw new AppError('tenantSlug is required', 400);
      const tenant = await findTenantBySlug(slug, dbOrTx);
      if (!tenant) throw new AppError('Unknown tenant', 400);
      await setRlsTenantContext(tenant.id, dbOrTx);

      const existingPhone = await findUserByPhone(tenant.id, input.phone, dbOrTx);
      if (existingPhone) throw new AppError('Phone already registered', 409);
      if (input.email) {
        const existingEmail = await findUserByEmail(tenant.id, input.email, dbOrTx);
        if (existingEmail) throw new AppError('Email already registered', 409);
      }

      const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);
      const user = await createUser(
        {
          tenantId: tenant.id,
          name: input.name,
          phone: input.phone,
          email: input.email,
          passwordHash,
          role: 'customer',
        },
        dbOrTx,
      );

      const tokens = await issueTokenPair(user.id, tenant.id, user.role, dbOrTx);
      return { user: sanitizeUser(user), tenant, ...tokens };
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  static async login(input: LoginInput, headerSlug?: string, tx?: DrizzleTx) {
    const run = async (dbOrTx: DBOrTx) => {
      // tenantSlug is required (enforced by Zod schema) to prevent cross-tenant
      // auth bypass. The header is accepted as a fallback for legacy clients.
      const slug = resolveTenantSlug(input.tenantSlug, headerSlug);
      if (!slug) throw new AppError('tenantSlug is required', 400);

      const found = await findTenantBySlug(slug, dbOrTx);
      if (!found) throw new AppError('Unknown tenant', 400);
      const tenant: { id: string } = found;
      await setRlsTenantContext(tenant.id, dbOrTx);

      let user:
        | Awaited<ReturnType<typeof findUserByEmail>>
        | Awaited<ReturnType<typeof findUserByPhone>>
        | undefined;
      user = await findUserByEmail(tenant.id, input.emailOrPhone, dbOrTx);
      if (!user) user = await findUserByPhone(tenant.id, input.emailOrPhone, dbOrTx);

      if (!user) throw new AppError('Invalid credentials', 401);
      const match = await bcrypt.compare(input.password, user.passwordHash);
      if (!match) throw new AppError('Invalid credentials', 401);
      if (user.isActive === false) throw new AppError('Account disabled', 401);

      const tokens = await issueTokenPair(user.id, user.tenantId, user.role, dbOrTx);
      return { user: sanitizeUser(user), ...tokens };
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  static async refresh(rawToken: string, tx?: DrizzleTx) {
    if (!rawToken) throw new AppError('Refresh token required', 401);
    const run = async (dbOrTx: DBOrTx) => {
      const hash = sha256(rawToken);
      const stored = await findValidRefreshTokenByHash(hash, dbOrTx);
      if (!stored) throw new AppError('Invalid refresh token', 401);
      await setRlsTenantContext(stored.tenantId, dbOrTx);

      const user = await findUserById(stored.userId, stored.tenantId, dbOrTx);
      if (!user || user.isActive === false) throw new AppError('Invalid refresh token', 401);

      await revokeRefreshTokenById(stored.id, dbOrTx);
      await getCache().del(`refresh:${hash}`);

      const tokens = await issueTokenPair(user.id, user.tenantId, user.role, dbOrTx);
      return { user: sanitizeUser(user), ...tokens };
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  static async logout(rawToken: string, tx?: DrizzleTx): Promise<void> {
    if (!rawToken) return;
    const run = async (dbOrTx: DBOrTx) => {
      const hash = sha256(rawToken);
      await revokeRefreshTokenByHash(hash, dbOrTx);
      await getCache().del(`refresh:${hash}`);
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }
}

export class UserService {
  static async getProfile(tenantId: string, userId: string, tx?: DrizzleTx) {
    const dbOrTx: DBOrTx = tx ?? db;
    const user = await findUserById(userId, tenantId, dbOrTx);
    if (!user) throw new AppError('User not found', 404);
    return sanitizeUser(user);
  }

  static async updateProfile(
    tenantId: string,
    userId: string,
    input: UpdateProfileInput,
    tx?: DrizzleTx,
  ) {
    const run = async (dbOrTx: DBOrTx) => {
      if (input.phone) {
        const existing = await findUserByPhone(tenantId, input.phone, dbOrTx);
        if (existing && existing.id !== userId) throw new AppError('Phone already in use', 409);
      }
      const updated = await updateUserById(
        userId,
        tenantId,
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.preferredTimeSlot !== undefined
            ? { preferredTimeSlot: input.preferredTimeSlot }
            : {}),
          ...(input.defaultDeliveryNotes !== undefined
            ? { defaultDeliveryNotes: input.defaultDeliveryNotes }
            : {}),
        },
        dbOrTx,
      );
      if (!updated) throw new AppError('User not found', 404);
      return sanitizeUser(updated);
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  static async listAdmin(tenantId: string, query: AdminListQuery, tx?: DrizzleTx) {
    const dbOrTx: DBOrTx = tx ?? db;
    const { page, limit, offset } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
    const filters = {
      role: query.role,
      isActive: query.isActive,
      balance: query.balance,
      unassigned: query.unassigned,
      search: query.search,
    };
    const [rows, total] = await Promise.all([
      listUsersWithCounts(tenantId, filters, { limit, offset }, dbOrTx),
      countUsers(tenantId, filters, dbOrTx),
    ]);
    const items = rows.map((r) => ({
      ...sanitizeUser(r.user),
      orderCount: Number(r.orderCount ?? 0),
      subscriptionCount: Number(r.subscriptionCount ?? 0),
    }));
    return { items, meta: buildMeta(total, page, limit) };
  }

  static async getAdminDetail(tenantId: string, id: string, tx?: DrizzleTx) {
    const dbOrTx: DBOrTx = tx ?? db;
    const user = await findUserById(id, tenantId, dbOrTx);
    if (!user) throw new AppError('User not found', 404);
    const [recentOrders, activeSubscriptions] = await Promise.all([
      getRecentOrders(id, tenantId, 5, dbOrTx),
      getActiveSubscriptions(id, tenantId, dbOrTx),
    ]);
    return {
      user: sanitizeUser(user),
      recentOrders,
      activeSubscriptions,
    };
  }

  static async createAdminUser(
    tenantId: string,
    createdById: string,
    input: AdminCreateUserInput,
    tx?: DrizzleTx,
  ) {
    const run = async (dbOrTx: DBOrTx) => {
      const existingPhone = await findUserByPhone(tenantId, input.phone, dbOrTx);
      if (existingPhone) throw new AppError('Phone already registered', 409);
      if (input.email) {
        const existingEmail = await findUserByEmail(tenantId, input.email, dbOrTx);
        if (existingEmail) throw new AppError('Email already registered', 409);
      }
      const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);
      const user = await createUser(
        {
          tenantId,
          name: input.name,
          phone: input.phone,
          email: input.email,
          passwordHash,
          role: input.role,
          assignedAreaId: input.assignedAreaId,
          deliverySequence: input.deliverySequence,
          createdById,
        },
        dbOrTx,
      );
      if (DELIVERY_ROLES.has(user.role)) {
        await ensureAgentProfile(user.id, tenantId, dbOrTx);
      }
      return sanitizeUser(user);
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  static async updateAdminUser(
    tenantId: string,
    id: string,
    input: AdminUpdateUserInput,
    tx?: DrizzleTx,
  ) {
    const run = async (dbOrTx: DBOrTx) => {
      const existing = await findUserById(id, tenantId, dbOrTx);
      if (!existing) throw new AppError('User not found', 404);

      if (input.phone && input.phone !== existing.phone) {
        const clash = await findUserByPhone(tenantId, input.phone, dbOrTx);
        if (clash && clash.id !== id) throw new AppError('Phone already in use', 409);
      }
      if (input.email !== undefined && input.email !== existing.email && input.email !== null) {
        const clash = await findUserByEmail(tenantId, input.email, dbOrTx);
        if (clash && clash.id !== id) throw new AppError('Email already in use', 409);
      }

      let passwordHash: string | undefined;
      if (input.password) passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);

      const updated = await updateUserById(
        id,
        tenantId,
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(passwordHash ? { passwordHash } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.assignedAreaId !== undefined ? { assignedAreaId: input.assignedAreaId } : {}),
          ...(input.deliverySequence !== undefined
            ? { deliverySequence: input.deliverySequence }
            : {}),
          ...(input.preferredTimeSlot !== undefined
            ? { preferredTimeSlot: input.preferredTimeSlot }
            : {}),
          ...(input.defaultDeliveryNotes !== undefined
            ? { defaultDeliveryNotes: input.defaultDeliveryNotes }
            : {}),
          ...(input.profilePicUrl !== undefined ? { profilePicUrl: input.profilePicUrl } : {}),
        },
        dbOrTx,
      );
      if (!updated) throw new AppError('User not found', 404);
      if (DELIVERY_ROLES.has(updated.role)) {
        await ensureAgentProfile(updated.id, tenantId, dbOrTx);
      }
      return sanitizeUser(updated);
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }

  static async updateDeliveryConfig(
    tenantId: string,
    id: string,
    input: DeliveryConfigInput,
    tx?: DrizzleTx,
  ) {
    const run = async (dbOrTx: DBOrTx) => {
      const existing = await findUserById(id, tenantId, dbOrTx);
      if (!existing) throw new AppError('User not found', 404);
      const updated = await updateUserById(
        id,
        tenantId,
        {
          assignedAreaId: input.assignedAreaId,
          deliverySequence: input.deliverySequence,
        },
        dbOrTx,
      );
      if (!updated) throw new AppError('User not found', 404);
      if (DELIVERY_ROLES.has(updated.role)) {
        await ensureAgentProfile(updated.id, tenantId, dbOrTx);
      }
      return sanitizeUser(updated);
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }
}
