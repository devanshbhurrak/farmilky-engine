import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { closeDB, db } from '../src/shared/db/client.js';
import { validateEnv } from '../src/shared/config/env.js';
import { tenants, users } from '../src/shared/db/schema/index.js';

// ─── Seed configuration (override via env vars) ─────────────────────────────
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'Farmilky';
const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? 'farmilky';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Admin';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@farmilky.in';
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '9876543210';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@1234';

// Mirrors user.schema.ts: /^[6-9]\d{9}$/
const PHONE_RE = /^[6-9]\d{9}$/;

/**
 * Idempotent seed: ensures a tenant exists and an admin user can log in to
 * the management portal (farmilky-management-v2) via
 *   POST /api/users/login { tenantSlug, emailOrPhone, password }
 *
 * Safe to re-run — an existing admin's password is reset to the configured one.
 */
async function seedAdmin() {
  validateEnv();

  if (!PHONE_RE.test(ADMIN_PHONE)) {
    throw new Error(`SEED_ADMIN_PHONE must match ${PHONE_RE} (got "${ADMIN_PHONE}")`);
  }

  // 1. Ensure the tenant exists (login is tenant-scoped by slug).
  let tenant = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  let createdTenant = false;
  if (tenant.length === 0) {
    const inserted = await db.insert(tenants).values({ name: TENANT_NAME, slug: TENANT_SLUG }).returning();
    tenant = inserted;
    createdTenant = true;
    console.log(`Created tenant "${TENANT_NAME}" (slug: ${TENANT_SLUG}, id: ${inserted[0].id})`);
  }
  const tenantId = tenant[0].id;

  // 2. Upsert the admin user inside a transaction with the RLS tenant
  //    context set. set_config(..., true) is transaction-local (== SET LOCAL)
  //    and — unlike `SET LOCAL app.tenant_id = $1` — accepts bind parameters.
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);

    const existing = await tx
      .select()
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL))
      .limit(1);

    if (existing.length > 0) {
      const updated = await tx
        .update(users)
        .set({ passwordHash, role: 'admin', isActive: true, updatedAt: new Date() })
        .where(eq(users.id, existing[0].id))
        .returning();
      return { user: updated[0], created: false };
    }

    const inserted = await tx
      .insert(users)
      .values({
        tenantId,
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        phone: ADMIN_PHONE,
        passwordHash,
        role: 'admin',
        isActive: true,
      })
      .returning();
    return { user: inserted[0], created: true };
  });

  // 3. Print login details.
  console.log(result.created ? 'Admin user created:' : 'Admin user updated:');
  console.log(`  tenant slug : ${TENANT_SLUG}${createdTenant ? ' (new)' : ''}`);
  console.log(`  email       : ${result.user.email}`);
  console.log(`  phone       : ${result.user.phone}`);
  console.log(`  password    : ${ADMIN_PASSWORD}`);
  console.log(`  role        : ${result.user.role}`);
  console.log('');
  console.log('Portal login:');
  console.log(`  POST ${process.env.BACKEND_URL ?? 'http://localhost:4000'}/api/users/login`);
  console.log(`  { "tenantSlug": "${TENANT_SLUG}", "emailOrPhone": "${ADMIN_EMAIL}", "password": "${ADMIN_PASSWORD}" }`);

  await closeDB();
}

seedAdmin().catch((err) => {
  console.error('Seed failed:', err);
  void closeDB().finally(() => process.exit(1));
});
