import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

// ─── shared helpers ───────────────────────────────────────────────────────────

async function setupTenant(slug: string) {
  const { TenantService } = await import('../../modules/tenants/tenant.service.js');
  return TenantService.register({
    name: 'Sub Dairy',
    slug,
    adminName: 'Admin',
    adminEmail: `admin-${slug}@test.local`,
    adminPhone: '9876543210',
    adminPassword: 'password123',
  });
}

async function setupCustomer(slug: string, phone: string) {
  const { AuthService } = await import('../../modules/users/user.service.js');
  return AuthService.register({
    name: 'Cust',
    phone,
    password: 'password123',
    tenantSlug: slug,
  } as never);
}

async function setupProduct(tenantId: string, price = 60) {
  const { createProduct } = await import('../../modules/products/product.service.js');
  const product = await createProduct(tenantId, {
    name: 'Milk',
    category: 'milk',
    variants: [{ label: '1L', quantity: 1, unit: 'L', price, stock: 100 }],
  } as never);
  return { product, variantId: (product.variants as Array<{ id: string }>)[0].id };
}

async function getBalance(userId: string): Promise<number> {
  const { db } = await import('../../shared/db/client.js');
  const { users } = await import('../../shared/db/schema/index.js');
  const { eq } = await import('drizzle-orm');
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return Number(rows[0]?.accountBalance ?? NaN);
}

// ─── core delivery flow ───────────────────────────────────────────────────────

dbOnly('subscriptions – delivery and correction', () => {
  it('create → delivery debit increases balance → correction to skipped reverts balance', async () => {
    const { createSubscription, recordDeliveryOutcome, pauseSubscription } =
      await import('../../modules/subscriptions/subscription.service.js');
    const { isSubscriptionDueOnDate } = await import(
      '../../modules/subscriptions/subscription.schedule.js'
    );
    const { toDateOnlyString, istToday } = await import('../../shared/utils/dateUtils.js');

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123456782');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId, 60);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 2, deliverySlot: 'morning' } as never,
      adminId,
    );

    expect(await getBalance(userId)).toBe(0);

    const today = toDateOnlyString(istToday());

    // Delivered → 2 × 60 = 120 debit
    await recordDeliveryOutcome(
      sub.id,
      tenantId,
      { deliveryDate: today, status: 'delivered' } as never,
      adminId,
    );
    expect(await getBalance(userId)).toBe(120);

    // Correction to skipped → reversal, balance returns to 0
    await recordDeliveryOutcome(
      sub.id,
      tenantId,
      { deliveryDate: today, status: 'skipped', reason: 'customer absent' } as never,
      adminId,
    );
    expect(await getBalance(userId)).toBe(0);

    // Pause gates due-ness
    const paused = await pauseSubscription(tenantId, sub.id, 'vacation soon', userId);
    expect(isSubscriptionDueOnDate(paused as never, new Date())).toBe(false);
  });
});

// ─── pause / resume ───────────────────────────────────────────────────────────

dbOnly('subscriptions – pause and resume', () => {
  it('pause blocks due-ness; resume restores it', async () => {
    const { createSubscription, pauseSubscription, resumeSubscription } =
      await import('../../modules/subscriptions/subscription.service.js');
    const { isSubscriptionDueOnDate } = await import(
      '../../modules/subscriptions/subscription.schedule.js'
    );

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123000020');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    const paused = await pauseSubscription(tenantId, sub.id, 'going on trip', userId);
    expect((paused as { status: string }).status).toBe('paused');
    expect(isSubscriptionDueOnDate(paused as never, new Date())).toBe(false);

    const resumed = await resumeSubscription(tenantId, sub.id, userId);
    expect((resumed as { status: string }).status).toBe('active');
    expect(isSubscriptionDueOnDate(resumed as never, new Date())).toBe(true);
  });
});

// ─── cancel ──────────────────────────────────────────────────────────────────

dbOnly('subscriptions – cancel', () => {
  it('cancel marks subscription cancelled; cancelled sub is never due', async () => {
    const { createSubscription, cancelSubscription } =
      await import('../../modules/subscriptions/subscription.service.js');
    const { isSubscriptionDueOnDate } = await import(
      '../../modules/subscriptions/subscription.schedule.js'
    );

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123000021');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    const cancelled = await cancelSubscription(tenantId, sub.id, userId);
    expect((cancelled as { status: string }).status).toBe('cancelled');
    expect(isSubscriptionDueOnDate(cancelled as never, new Date())).toBe(false);
  });
});

// ─── vacation window ──────────────────────────────────────────────────────────

dbOnly('subscriptions – vacation window', () => {
  it('dates inside vacation window are not due; dates outside are due', async () => {
    const { createSubscription, setVacation, cancelVacation } =
      await import('../../modules/subscriptions/subscription.service.js');
    const { isSubscriptionDueOnDate } = await import(
      '../../modules/subscriptions/subscription.schedule.js'
    );

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123000022');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    const withVac = await setVacation(
      tenantId,
      sub.id,
      { vacationFrom: '2030-01-10', vacationUntil: '2030-01-20' },
      userId,
    );

    // Inside window (inclusive boundaries)
    expect(isSubscriptionDueOnDate(withVac as never, new Date(2030, 0, 10))).toBe(false);
    expect(isSubscriptionDueOnDate(withVac as never, new Date(2030, 0, 15))).toBe(false);
    expect(isSubscriptionDueOnDate(withVac as never, new Date(2030, 0, 20))).toBe(false);
    // Day after window ends
    expect(isSubscriptionDueOnDate(withVac as never, new Date(2030, 0, 21))).toBe(true);

    // Clear vacation → all dates due again
    const cleared = await cancelVacation(tenantId, sub.id, userId);
    expect((cleared as { vacationFrom: unknown }).vacationFrom).toBeNull();
    expect(isSubscriptionDueOnDate(cleared as never, new Date(2030, 0, 15))).toBe(true);
  });

  it('vacation start after vacation end is rejected', async () => {
    const { createSubscription, setVacation } =
      await import('../../modules/subscriptions/subscription.service.js');

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123000023');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    await expect(
      setVacation(tenantId, sub.id, { vacationFrom: '2030-01-20', vacationUntil: '2030-01-10' }, userId),
    ).rejects.toThrow();
  });
});

// ─── skip / unskip ────────────────────────────────────────────────────────────

dbOnly('subscriptions – skip and unskip', () => {
  it('skip a future date → not due that day → unskip → due again', async () => {
    const { createSubscription, skipDeliveryDate, unskipDeliveryDate } =
      await import('../../modules/subscriptions/subscription.service.js');
    const { isSubscriptionDueOnDate } = await import(
      '../../modules/subscriptions/subscription.schedule.js'
    );

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123000024');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    const futureDateStr = '2030-03-15';
    const futureDateObj = new Date(2030, 2, 15);

    const skipped = await skipDeliveryDate(tenantId, sub.id, futureDateStr, userId);
    expect(isSubscriptionDueOnDate(skipped as never, futureDateObj)).toBe(false);

    const unskipped = await unskipDeliveryDate(tenantId, sub.id, futureDateStr, userId);
    expect(isSubscriptionDueOnDate(unskipped as never, futureDateObj)).toBe(true);
  });

  it('cannot skip a past date', async () => {
    const { createSubscription, skipDeliveryDate } =
      await import('../../modules/subscriptions/subscription.service.js');

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123000025');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    await expect(
      skipDeliveryDate(tenantId, sub.id, '2020-01-01', userId),
    ).rejects.toThrow();
  });
});

// ─── delivery slot immutability ───────────────────────────────────────────────

dbOnly('subscriptions – delivery slot is immutable', () => {
  it('attempting to change delivery_slot throws', async () => {
    const { createSubscription, adminUpdateSubscription } =
      await import('../../modules/subscriptions/subscription.service.js');

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const cust = await setupCustomer(slug, '9123000026');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId);

    const sub = await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    await expect(
      adminUpdateSubscription(
        tenantId,
        sub.id,
        { deliverySlot: 'evening' } as never,
        adminId,
      ),
    ).rejects.toThrow();
  });
});

// ─── customer-specific pricing ────────────────────────────────────────────────

dbOnly('subscriptions – customer-specific pricing', () => {
  it('resolvePrice uses variant price when no customer-specific override exists', async () => {
    const { resolvePrice } = await import('../../modules/products/product.service.js');

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const cust = await setupCustomer(slug, '9123000027');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId, 60);

    // No customer-specific price set → should return the variant price
    const result = await resolvePrice(tenantId, userId, variantId);
    expect(result.price).toBe(60);
    expect(result.isCustom).toBe(false);
  });

  it('resolvePrice uses customer price when an override exists', async () => {
    const { resolvePrice } = await import('../../modules/products/product.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { customerPrices } = await import('../../shared/db/schema/index.js');
    const { toDateOnlyString, istToday } = await import('../../shared/utils/dateUtils.js');

    const slug = tenantSlug();
    const reg = await setupTenant(slug);
    const tenantId = reg.tenant.id;
    const cust = await setupCustomer(slug, '9123000028');
    const userId = cust.user.id as string;
    const { product, variantId } = await setupProduct(tenantId, 60);

    // Insert customer-specific price directly (no service function yet for this)
    const today = toDateOnlyString(istToday());
    await db.insert(customerPrices).values({
      tenantId,
      userId,
      productId: product.id,
      variantId,
      price: '50',
      effectiveFrom: today,
      effectiveUntil: null,
    } as never);

    const result = await resolvePrice(tenantId, userId, variantId);
    expect(result.price).toBe(50);
    expect(result.isCustom).toBe(true);
  });
});

// ─── tenant isolation ─────────────────────────────────────────────────────────

dbOnly('subscriptions – tenant isolation', () => {
  it('subscription in tenant A is not accessible from tenant B', async () => {
    const { createSubscription, getSubscriptionById } =
      await import('../../modules/subscriptions/subscription.service.js');

    const slugA = tenantSlug();
    const slugB = tenantSlug();
    const regA = await setupTenant(slugA);
    const regB = await setupTenant(slugB);
    const tenantAId = regA.tenant.id;
    const tenantBId = regB.tenant.id;
    const adminAId = (regA.admin as { id: string }).id;

    const custA = await setupCustomer(slugA, '9123000028');
    const userAId = custA.user.id as string;
    const { product: prodA, variantId: varAId } = await setupProduct(tenantAId);

    const sub = await createSubscription(
      tenantAId,
      userAId,
      { productId: prodA.id, variantId: varAId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminAId,
    );

    // Tenant B cannot see tenant A's subscription (RLS gates by tenantId)
    await expect(
      getSubscriptionById(tenantBId, sub.id, { id: userAId, isAdmin: true }),
    ).rejects.toThrow();
  });
});

describe('subscriptions (no db)', () => {
  it('placeholder passes without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});
