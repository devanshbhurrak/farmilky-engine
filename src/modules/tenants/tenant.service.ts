import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { env } from '../../shared/config/env.js';
import { getCache } from '../../shared/cache/index.js';
import { generateTokenId, sha256 } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import type { RegisterTenantInput, UpdateTenantInput } from './tenant.schema.js';
import {
  createTenant,
  findTenantById,
  findTenantBySlug,
  seedInvoiceCounter,
  seedTransactionCounters,
  updateTenantById,
} from './tenant.repository.js';
import { createRefreshToken, createUser } from '../users/user.repository.js';

const TXN_TYPES = [
  'delivery',
  'order',
  'payment',
  'credit_adjustment',
  'debit_adjustment',
  'return_refund',
  'opening_balance',
  'milk_collection',
  'supplier_payment',
  'supplier_adjustment',
  'expense',
];

const REFRESH_TTL_SECONDS = 30 * 24 * 3600;

function signAccessToken(userId: string, tenantId: string, role: string): string {
  return jwt.sign({ userId, tenantId, role }, env.jwtAccessSecret, { expiresIn: '15m' });
}

function sanitizeAdmin<T extends Record<string, unknown>>(admin: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _omitted, ...rest } = admin;
  void _omitted;
  return rest;
}

async function issueRefreshToken(
  userId: string,
  tenantId: string,
  dbOrTx: DBOrTx,
): Promise<{ raw: string; hash: string }> {
  const raw = generateTokenId();
  const hash = sha256(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await createRefreshToken(
    { tenantId, userId, tokenHash: hash, expiresAt },
    dbOrTx,
  );
  await getCache().set(`refresh:${hash}`, { userId, tenantId }, REFRESH_TTL_SECONDS);
  return { raw, hash };
}

export class TenantService {
  static async register(input: RegisterTenantInput, tx?: DrizzleTx) {
    const run = async (dbOrTx: DBOrTx) => {
      const existing = await findTenantBySlug(input.slug, dbOrTx);
      if (existing) throw new AppError('Slug already taken', 409);

      const tenant = await createTenant(
        {
          name: input.name,
          slug: input.slug,
          brandPhone: input.brandPhone,
          upiId: input.upiId,
          upiName: input.upiName,
          brandLogoUrl: input.brandLogoUrl,
          backendUrl: input.backendUrl,
        },
        dbOrTx,
      );

      const passwordHash = await bcrypt.hash(input.adminPassword, env.bcryptRounds);
      const admin = await createUser(
        {
          tenantId: tenant.id,
          name: input.adminName,
          email: input.adminEmail,
          phone: input.adminPhone,
          passwordHash,
          role: 'admin',
        },
        dbOrTx,
      );

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      await seedTransactionCounters(tenant.id, year, TXN_TYPES, dbOrTx);
      await seedInvoiceCounter(tenant.id, year, month, dbOrTx);

      const accessToken = signAccessToken(admin.id, tenant.id, admin.role);
      const { raw: refreshToken } = await issueRefreshToken(admin.id, tenant.id, dbOrTx);

      return { tenant, admin: sanitizeAdmin(admin), accessToken, refreshToken };
    };

    if (tx) return run(tx);
    return withTransaction(run);
  }

  static async getById(tenantId: string, tx?: DrizzleTx) {
    const dbOrTx: DBOrTx = tx ?? db;
    const tenant = await findTenantById(tenantId, dbOrTx);
    if (!tenant) throw new AppError('Tenant not found', 404);
    return tenant;
  }

  static async update(tenantId: string, input: UpdateTenantInput, tx?: DrizzleTx) {
    const run = async (dbOrTx: DBOrTx) => {
      const updated = await updateTenantById(tenantId, input, dbOrTx);
      if (!updated) throw new AppError('Tenant not found', 404);
      return updated;
    };
    if (tx) return run(tx);
    return withTransaction(run);
  }
}
