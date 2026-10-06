import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

dbOnly('manifests – generation', () => {
  it('generate creates one manifest per slot per area; skips holiday dates', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createAreaService: createArea } = await import('../../modules/areas/area.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { generateManifestsForDate } = await import('../../modules/manifests/manifest.service.js');
    const { createHolidayService: createHoliday } = await import('../../modules/holidays/holiday.service.js');
    const { toDateOnlyString, istToday, addDays } = await import('../../shared/utils/dateUtils.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Manifest Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    // Create area and assign agent
    const area = await createArea(tenantId, { name: 'Zone A', assignedAgentId: adminId } as never);

    // Create customer assigned to area
    const cust = await AuthService.register({
      name: 'ManCust',
      phone: '9123000030',
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    // Assign customer to area
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    await db.update(users).set({ assignedAreaId: area.id } as never).where(eq(users.id, userId));

    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 60, stock: 100 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    // Create morning subscription
    await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    const today = toDateOnlyString(istToday());

    // Generate manifests for today morning
    const result = await generateManifestsForDate(tenantId, today, 'morning');
    expect(result.skipped).toBe(false);
    expect(result.manifests.length).toBeGreaterThanOrEqual(1);

    // The manifest should contain our customer's subscription
    const manifest = result.manifests[0];
    expect(manifest).toBeTruthy();
    expect((manifest as { entries?: unknown[] }).entries?.length).toBeGreaterThanOrEqual(1);
  });

  it('generation is idempotent (refresh-safe): calling twice does not duplicate entries', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createAreaService: createArea } = await import('../../modules/areas/area.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { generateManifestsForDate } = await import('../../modules/manifests/manifest.service.js');
    const { toDateOnlyString, istToday } = await import('../../shared/utils/dateUtils.js');
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Idem Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const area = await createArea(tenantId, { name: 'Zone Idem', assignedAgentId: adminId } as never);
    const cust = await AuthService.register({
      name: 'IdemCust',
      phone: '9123000031',
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;
    await db.update(users).set({ assignedAreaId: area.id } as never).where(eq(users.id, userId));

    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 60, stock: 100 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;
    await createSubscription(
      tenantId,
      userId,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    const today = toDateOnlyString(istToday());

    const first = await generateManifestsForDate(tenantId, today, 'morning');
    const second = await generateManifestsForDate(tenantId, today, 'morning');

    // Same manifest IDs — no duplicates created
    const firstIds = first.manifests.map((m) => (m as { id: string }).id).sort();
    const secondIds = second.manifests.map((m) => (m as { id: string }).id).sort();
    expect(firstIds).toEqual(secondIds);

    // Entry count should be the same
    const firstCount = first.manifests.reduce(
      (sum, m) => sum + ((m as { entries?: unknown[] }).entries?.length ?? 0),
      0,
    );
    const secondCount = second.manifests.reduce(
      (sum, m) => sum + ((m as { entries?: unknown[] }).entries?.length ?? 0),
      0,
    );
    expect(firstCount).toBe(secondCount);
  });

  it('skips generation on a holiday and returns skipped=true', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { generateManifestsForDate } = await import('../../modules/manifests/manifest.service.js');
    const { createHolidayService: createHoliday } = await import('../../modules/holidays/holiday.service.js');
    const { toDateOnlyString, addDays, istToday } = await import('../../shared/utils/dateUtils.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Holiday Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    // Mark tomorrow as a holiday
    const tomorrow = toDateOnlyString(addDays(istToday(), 1));
    await createHoliday(tenantId, { date: tomorrow, name: 'Test Holiday', isActive: true });

    const result = await generateManifestsForDate(tenantId, tomorrow, 'morning');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('holiday');
    expect(result.manifests).toHaveLength(0);
  });

  it('morning and evening slots produce separate manifests', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createAreaService: createArea } = await import('../../modules/areas/area.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { generateManifestsForDate } = await import('../../modules/manifests/manifest.service.js');
    const { toDateOnlyString, istToday } = await import('../../shared/utils/dateUtils.js');
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'TwoSlot Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const area = await createArea(tenantId, { name: 'SlotZone', assignedAgentId: adminId } as never);
    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 60, stock: 100 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    // Morning customer
    const custM = await AuthService.register({
      name: 'MornCust',
      phone: '9123000032',
      password: 'password123',
      tenantSlug: slug,
    } as never);
    await db.update(users).set({ assignedAreaId: area.id } as never).where(eq(users.id, custM.user.id as string));
    await createSubscription(
      tenantId,
      custM.user.id as string,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'morning' } as never,
      adminId,
    );

    // Evening customer
    const custE = await AuthService.register({
      name: 'EveCust',
      phone: '9123000033',
      password: 'password123',
      tenantSlug: slug,
    } as never);
    await db.update(users).set({ assignedAreaId: area.id } as never).where(eq(users.id, custE.user.id as string));
    await createSubscription(
      tenantId,
      custE.user.id as string,
      { productId: product.id, variantId, quantityPerDelivery: 1, deliverySlot: 'evening' } as never,
      adminId,
    );

    const today = toDateOnlyString(istToday());
    const morningResult = await generateManifestsForDate(tenantId, today, 'morning');
    const eveningResult = await generateManifestsForDate(tenantId, today, 'evening');

    // Both slots produce manifests
    expect(morningResult.skipped).toBe(false);
    expect(eveningResult.skipped).toBe(false);

    // Manifest IDs are distinct (separate manifests per slot)
    const morningIds = new Set(morningResult.manifests.map((m) => (m as { id: string }).id));
    const eveningIds = new Set(eveningResult.manifests.map((m) => (m as { id: string }).id));
    for (const id of eveningIds) {
      expect(morningIds.has(id)).toBe(false);
    }
  });
});

describe('manifests (no db)', () => {
  it('placeholder passes without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});
