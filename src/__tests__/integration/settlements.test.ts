import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { toDateOnlyString, istToday } from '../../shared/utils/dateUtils.js';

describe('Central Ledger & Settlement Engine Integration Suite', () => {
  it('delivers with on-the-spot payment: records debit, credit, and targeted settlement atomically', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { recordDeliveryOutcome } = await import('../../modules/deliveries/delivery.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { findActiveSettlementsForDebit } = await import('../../modules/transactions/settlement.repository.js');
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Settlement Test Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Spot Customer',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Full Cream Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 60, stock: 100 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    const today = toDateOnlyString(istToday());
    const sub = await createSubscription(
      tenantId,
      userId,
      {
        productId: product.id,
        variantId,
        quantityPerDelivery: 2,
        deliverySlot: 'morning',
        deliverySchedule: 'daily',
        startDate: today,
        pricePerPacket: 60,
      } as never,
      adminId,
    );

    // Record delivery outcome with paymentCollected = ₹120 (Cash)
    const outcome = await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: today,
        deliverySlot: 'morning',
        status: 'delivered',
        paymentReceived: {
          amount: 120,
          paymentMethod: 'cash',
        },
      },
      adminId,
    );

    expect(outcome.delivery.status).toBe('delivered');
    expect(outcome.delivery.paymentStatus).toBe('paid');
    expect(outcome.transactionId).toBeDefined();

    // Verify balance is unchanged (Net 0)
    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(Number(userRow[0]!.accountBalance)).toBe(0);

    // Verify settlement record exists and debit is paid
    const settlements = await findActiveSettlementsForDebit(tenantId, outcome.transactionId!, db as any);
    expect(settlements.length).toBe(1);
    expect(Number(settlements[0]!.amount)).toBe(120);

    const status = await settlementService.getDebitSettlementStatus(tenantId, outcome.transactionId!, db as any);
    expect(status.status).toBe('paid');
    expect(status.outstandingAmount).toBe(0);
  });

  it('targeted delivery payment does NOT leak excess into unrelated debits', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { recordDeliveryOutcome } = await import('../../modules/deliveries/delivery.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Leak Test Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Leak Customer',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Paneer',
      category: 'paneer',
      variants: [{ label: '500g', quantity: 1, unit: 'g', price: 100, stock: 100 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    const today = toDateOnlyString(istToday());
    const sub = await createSubscription(
      tenantId,
      userId,
      {
        productId: product.id,
        variantId,
        quantityPerDelivery: 1,
        deliverySlot: 'morning',
        deliverySchedule: 'daily',
        startDate: today,
        pricePerPacket: 100,
      } as never,
      adminId,
    );

    // Delivery 1: Unpaid (₹100 outstanding)
    const del1 = await recordDeliveryOutcome(
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

    // Delivery 2: Paid on the spot with ₹150 for a ₹100 delivery (₹50 excess)
    const tomorrow = toDateOnlyString(new Date(Date.now() + 86400000));
    const del2 = await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: tomorrow,
        deliverySlot: 'morning',
        status: 'delivered',
        paymentReceived: {
          amount: 150,
          paymentMethod: 'cash',
        },
      },
      adminId,
    );

    // Delivery 1 must still be UNPAID with ₹100 outstanding (zero leak invariant)
    const del1Status = await settlementService.getDebitSettlementStatus(tenantId, del1.transactionId!, db as any);
    expect(del1Status.status).toBe('unpaid');
    expect(del1Status.outstandingAmount).toBe(100);

    // Delivery 2 must be fully PAID
    const del2Status = await settlementService.getDebitSettlementStatus(tenantId, del2.transactionId!, db as any);
    expect(del2Status.status).toBe('paid');
    expect(del2Status.outstandingAmount).toBe(0);

    // Customer balance: +100 (del1) + 100 (del2) - 150 (pay2) = +50
    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(Number(userRow[0]!.accountBalance)).toBe(50);
  });

  it('FIFO payment settlement across previous and current dues', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { db } = await import('../../shared/db/client.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'FIFO Test Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'FIFO Customer',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    // Create 2 historical debits
    const d1 = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: userId,
        txnType: 'delivery',
        entryType: 'debit',
        amount: 200,
        effectiveDate: '2026-09-15',
        description: 'September delivery',
        createdById: adminId,
      },
      db as any,
    );

    const d2 = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: userId,
        txnType: 'delivery',
        entryType: 'debit',
        amount: 300,
        effectiveDate: '2026-10-10',
        description: 'October delivery',
        createdById: adminId,
      },
      db as any,
    );

    // Record general payment of ₹350
    const pay = await recordPayment(
      tenantId,
      {
        userId,
        amount: 350,
        date: '2026-10-15',
        paymentMethod: 'upi',
      },
      adminId,
    );

    // d1 (September ₹200) should be fully settled (PAID)
    const s1 = await settlementService.getDebitSettlementStatus(tenantId, d1.id, db as any);
    expect(s1.status).toBe('paid');
    expect(s1.outstandingAmount).toBe(0);

    // d2 (October ₹300) should be partially settled (₹150 paid, ₹150 remaining)
    const s2 = await settlementService.getDebitSettlementStatus(tenantId, d2.id, db as any);
    expect(s2.status).toBe('partially_paid');
    expect(s2.paidAmount).toBe(150);
    expect(s2.outstandingAmount).toBe(150);
  });

  it('preserves audit history: voiding a payment reverses settlements without physical row deletion', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { transactionSettlements } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Reversal Test Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Reversal Customer',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    const debit = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: userId,
        txnType: 'delivery',
        entryType: 'debit',
        amount: 250,
        effectiveDate: '2026-10-01',
        description: 'Test delivery',
        createdById: adminId,
      },
      db as any,
    );

    const payment = await recordPayment(
      tenantId,
      {
        userId,
        amount: 250,
        date: '2026-10-02',
        paymentMethod: 'cash',
      },
      adminId,
    );

    // Assert debit is paid
    let status = await settlementService.getDebitSettlementStatus(tenantId, debit.id, db as any);
    expect(status.status).toBe('paid');

    // Void the payment
    await transactionService.voidTransaction(payment.id, tenantId, 'Customer cheque bounced', adminId);

    // Debit must revert to UNPAID
    status = await settlementService.getDebitSettlementStatus(tenantId, debit.id, db as any);
    expect(status.status).toBe('unpaid');
    expect(status.outstandingAmount).toBe(250);

    // Audit check: settlement row still exists in DB with status = 'reversed'
    const settlements = await db
      .select()
      .from(transactionSettlements)
      .where(eq(transactionSettlements.settlementTxnId, payment.id));
    expect(settlements.length).toBe(1);
    expect(settlements[0]!.status).toBe('reversed');
    expect(settlements[0]!.reversedAt).not.toBeNull();
  });
});
