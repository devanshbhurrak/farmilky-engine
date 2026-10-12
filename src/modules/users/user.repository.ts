import { and, count, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import {
  agentProfiles,
  orders,
  refreshTokens,
  subscriptions,
  users,
} from '../../shared/db/schema/index.js';
import type { DBOrTx } from '../../shared/types/index.js';

export interface AdminListFilters {
  role?: string;
  isActive?: string | boolean;
  balance?: 'positive' | 'negative' | 'zero';
  unassigned?: string | boolean;
  search?: string;
}

function buildUserWhere(tenantId: string, filters: AdminListFilters = {}) {
  const conds = [eq(users.tenantId, tenantId), isNull(users.deletedAt)];

  if (filters.role) {
    // Cast to the pg enum union; validated upstream where possible.
    conds.push(eq(users.role, filters.role as typeof users.$inferSelect.role));
  }

  if (filters.isActive !== undefined && filters.isActive !== '') {
    const v = filters.isActive;
    if (v === true || v === 'true') conds.push(eq(users.isActive, true));
    else if (v === false || v === 'false') conds.push(eq(users.isActive, false));
  }

  if (filters.balance === 'positive') {
    conds.push(sql`${users.accountBalance} > 0`);
  } else if (filters.balance === 'negative') {
    conds.push(sql`${users.accountBalance} < 0`);
  } else if (filters.balance === 'zero') {
    conds.push(sql`${users.accountBalance} = 0`);
  }

  if (filters.unassigned === true || filters.unassigned === 'true') {
    conds.push(isNull(users.assignedAreaId));
  }

  if (filters.search && filters.search.trim() !== '') {
    const q = `%${filters.search.trim()}%`;
    conds.push(
      or(
        ilike(users.name, q),
        ilike(users.phone, q),
        ilike(users.email, q),
      )!,
    );
  }

  return and(...conds);
}

export async function findUserById(id: string, tenantId: string, dbOrTx: DBOrTx = db) {
  const rows = await dbOrTx
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function findUserByEmail(tenantId: string, email: string, dbOrTx: DBOrTx = db) {
  const rows = await dbOrTx
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function findUserByPhone(tenantId: string, phone: string, dbOrTx: DBOrTx = db) {
  const rows = await dbOrTx
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function createUser(
  data: typeof users.$inferInsert,
  dbOrTx: DBOrTx = db,
) {
  const rows = await dbOrTx.insert(users).values(data).returning();
  return rows[0]!;
}

export async function updateUserById(
  id: string,
  tenantId: string,
  data: Partial<typeof users.$inferInsert>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await dbOrTx
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
    .returning();
  return rows[0];
}

export async function countUsers(
  tenantId: string,
  filters: AdminListFilters = {},
  dbOrTx: DBOrTx = db,
): Promise<number> {
  const where = buildUserWhere(tenantId, filters);
  const rows = await dbOrTx.select({ total: count() }).from(users).where(where);
  return Number(rows[0]?.total ?? 0);
}

export async function listUsersWithCounts(
  tenantId: string,
  filters: AdminListFilters = {},
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const where = buildUserWhere(tenantId, filters);
  const rows = await dbOrTx
    .select({
      user: users,
      orderCount: sql<number>`(select count(*)::int from orders where orders.user_id = ${users.id} and orders.tenant_id = ${users.tenantId})`,
      subscriptionCount: sql<number>`(select count(*)::int from subscriptions where subscriptions.user_id = ${users.id} and subscriptions.tenant_id = ${users.tenantId})`,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
  return rows;
}

export async function getRecentOrders(
  userId: string,
  tenantId: string,
  limit = 5,
  dbOrTx: DBOrTx = db,
) {
  return dbOrTx
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.tenantId, tenantId)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

export async function getActiveSubscriptions(
  userId: string,
  tenantId: string,
  dbOrTx: DBOrTx = db,
) {
  return dbOrTx
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.tenantId, tenantId),
        eq(subscriptions.status, 'active'),
      ),
    )
    .orderBy(desc(subscriptions.createdAt));
}

export async function createRefreshToken(
  data: typeof refreshTokens.$inferInsert,
  dbOrTx: DBOrTx = db,
) {
  const rows = await dbOrTx.insert(refreshTokens).values(data).returning();
  return rows[0]!;
}

export async function findValidRefreshTokenByHash(hash: string, dbOrTx: DBOrTx = db) {
  const rows = await dbOrTx
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, hash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function findRefreshTokenByHash(hash: string, dbOrTx: DBOrTx = db) {
  const rows = await dbOrTx
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hash))
    .limit(1);
  return rows[0];
}

export async function revokeRefreshTokenByHash(hash: string, dbOrTx: DBOrTx = db) {
  await dbOrTx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)));
}

export async function revokeRefreshTokenById(id: string, dbOrTx: DBOrTx = db) {
  await dbOrTx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, id));
}

export async function findAgentProfileByUserId(
  userId: string,
  tenantId: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await dbOrTx
    .select()
    .from(agentProfiles)
    .where(and(eq(agentProfiles.userId, userId), eq(agentProfiles.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function createAgentProfile(
  data: typeof agentProfiles.$inferInsert,
  dbOrTx: DBOrTx = db,
) {
  const rows = await dbOrTx.insert(agentProfiles).values(data).returning();
  return rows[0]!;
}

export async function ensureAgentProfile(
  userId: string,
  tenantId: string,
  dbOrTx: DBOrTx = db,
) {
  const existing = await findAgentProfileByUserId(userId, tenantId, dbOrTx);
  if (existing) return existing;
  return createAgentProfile({ userId, tenantId, availability: 'available' }, dbOrTx);
}
