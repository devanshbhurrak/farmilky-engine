import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

async function setupTenant(slug: string) {
  const { TenantService } = await import('../../modules/tenants/tenant.service.js');
  return TenantService.register({
    name: 'Del Dairy',
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

async function createSubDeliveryContext(slug: string) {
  const reg = await setupTenant(slug);
  const tenantId = reg.tenant.id;
  const adminId = (reg.admin as { id: string }).id;
  const cust = await setupCustomer(slug, `9${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  const userId = cust.user.id as string;
  const { product, variantId } = await setupProduct(tenantId, 60);
  const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
  const sub = await createSubscription(
    tenantId,
    userId,
    { productId: product.id, variantId, quantityPerDelivery: 2, deliverySlot: 'morning' } as never,
    adminId,
  );
  return { tenantId, adminId, userId, product, variantId, sub };
}

const { recordDeliveryOutcome, correctDelivery, rescheduleDelivery, cancelDelivery, recordPaymentAgainstDelivery, markMissedDeliveries, getCustomerDeliverySummary } = await import(
  '../../modules/deliveries/delivery.service.js'
);
const { toDateOnlyString, istToday, addDays } = await import('../../shared/utils/dateUtils.js');

dbOnly('deliveries – subscription workflow', () => {
  it('delivers a subscription delivery, debits balance', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const today = toDateOnlyString(istToday());

    expect(await getBalance(userId)).toBe(0);

    const result = await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: today,
        deliverySlot: 'morning',
        status: 'delivered',
      },
      adminId,
    );

    expect(result.transactionId).toBeTruthy();
    expect(result.delivery.status).toBe('delivered');
    expect(Number(result.delivery.totalAmount)).toBe(120);
    expect(await getBalance(userId)).toBe(120);
  });

  it('prevents duplicate charges via idempotency key', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const today = toDateOnlyString(istToday());
    const key = `idem-${slug}-${today}`;

    const first = await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'delivered', idempotencyKey: key },
      adminId,
    );
    expect(await getBalance(userId)).toBe(120);

    const second = await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'delivered', idempotencyKey: key },
      adminId,
    );
    expect(second.transactionId).toBeNull();
    expect(second.delivery.id).toBe(first.delivery.id);
    expect(await getBalance(userId)).toBe(120);
  });

  it('correcting a delivery reverses the old charge and re-charges correctly', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const today = toDateOnlyString(istToday());

    const first = await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'delivered' },
      adminId,
    );
    expect(await getBalance(userId)).toBe(120);

    const corrected = await correctDelivery(
      tenantId,
      first.delivery.id,
      { status: 'delivered', actualQuantity: 1, pricePerPacket: 60, reason: 'customer took 1' },
      adminId,
      Number(first.delivery.version),
    );

    expect(await getBalance(userId)).toBe(60);
    expect(Number(corrected.delivery.totalAmount)).toBe(60);
    expect(Number(corrected.delivery.actualQuantity)).toBe(1);
  });

  it('cancelling a charged delivery reverses the charge', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const today = toDateOnlyString(istToday());

    const delivered = await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'delivered' },
      adminId,
    );
    expect(await getBalance(userId)).toBe(120);

    const cancelled = await cancelDelivery(
      tenantId,
      delivered.delivery.id,
      { reason: 'customer moved', restock: true },
      adminId,
    );
    expect(cancelled.reversed).toBe(true);
    expect(cancelled.delivery.status).toBe('skipped');
    expect(await getBalance(userId)).toBe(0);
  });
});

dbOnly('deliveries – reschedule, payment, missed, summary', () => {
  it('reschedule creates a pending record and keeps the original', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const today = toDateOnlyString(istToday());
    const tomorrow = toDateOnlyString(addDays(new Date(today), 1));

    const first = await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'pending' },
      adminId,
    );
    expect(first.delivery.status).toBe('pending');

    const rescheduled = await rescheduleDelivery(
      tenantId,
      first.delivery.id,
      { newDeliveryDate: tomorrow, newDeliverySlot: 'evening', reason: 'customer away' },
      adminId,
    );
    expect(rescheduled.rescheduled).toBe(true);
    expect(rescheduled.delivery.status).toBe('pending');
    expect(rescheduled.delivery.deliveryDate).toBe(tomorrow);
    expect(rescheduled.delivery.rescheduledFromId).toBe(first.delivery.id);
  });

  it('partial payment then full payment marks delivery paid', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const today = toDateOnlyString(istToday());

    const delivered = await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'delivered' },
      adminId,
    );
    expect(await getBalance(userId)).toBe(120);

    const partial = await recordPaymentAgainstDelivery(
      tenantId,
      delivered.delivery.id,
      { amount: 50, paymentMethod: 'cash', description: 'partial' },
      adminId,
    );
    expect(partial.paymentStatus).toBe('partially_paid');
    expect(partial.outstanding).toBe(70);

    const full = await recordPaymentAgainstDelivery(
      tenantId,
      delivered.delivery.id,
      { amount: 70, paymentMethod: 'upi', paymentRef: 'upi-123', description: 'balance' },
      adminId,
    );
    expect(full.paymentStatus).toBe('paid');
    expect(full.outstanding).toBe(0);
    expect(await getBalance(userId)).toBe(0);
  });

  it('mark-missed flags stale pending deliveries', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const yesterday = toDateOnlyString(addDays(new Date(), -1));

    await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: yesterday, deliverySlot: 'morning', status: 'pending' },
      adminId,
    );

    const marked = await markMissedDeliveries(tenantId, yesterday);
    expect(marked.length).toBeGreaterThanOrEqual(1);
  });

  it('customer delivery summary aggregates charges and counts', async () => {
    const slug = tenantSlug();
    const { tenantId, adminId, userId, sub } = await createSubDeliveryContext(slug);
    const today = toDateOnlyString(istToday());

    await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'delivered' },
      adminId,
    );
    await recordDeliveryOutcome(
      tenantId,
      { customerId: userId, type: 'subscription', referenceType: 'subscription', referenceId: sub.id, deliveryDate: today, deliverySlot: 'morning', status: 'missed', reason: 'not attempted' },
      adminId,
    );

    const summary = await getCustomerDeliverySummary(tenantId, { customerId: userId, fromDate: today, toDate: today });
    expect(summary.deliveredCount).toBe(1);
    expect(summary.missedCount).toBe(1);
    expect(summary.totalCharges).toBe(120);
  });
});
