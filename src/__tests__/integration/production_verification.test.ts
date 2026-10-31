import { describe, expect, it } from 'vitest';
import { tenantSlug } from './helpers.js';
import { toDateOnlyString, istToday } from '../../shared/utils/dateUtils.js';

describe('Comprehensive Production Settlement, Concurrency & Invoicing Suite', () => {
  it('Req 1 & 2: Partial payments, multiple payments per delivery, one payment across multiple deliveries, excess advance credit, and no leakage', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { recordDeliveryOutcome, recordPaymentAgainstDelivery } = await import('../../modules/deliveries/delivery.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { users, deliveries } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Req12 Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Req12 Cust',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Cow Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 100, stock: 100 }],
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

    // 1. Delivery 1 (₹100) created with partial on-the-spot payment of ₹40
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
        paymentReceived: { amount: 40, paymentMethod: 'cash' },
      },
      adminId,
    );

    expect(del1.delivery.paymentStatus).toBe('partially_paid');
    let del1Stat = await settlementService.getDebitSettlementStatus(tenantId, del1.transactionId!, db as any);
    expect(del1Stat.status).toBe('partially_paid');
    expect(del1Stat.paidAmount).toBe(40);
    expect(del1Stat.outstandingAmount).toBe(60);

    // 2. Multiple payments on single delivery: Pay remaining ₹60 against Delivery 1
    const secondPay = await recordPaymentAgainstDelivery(
      tenantId,
      del1.delivery.id,
      { amount: 60, paymentMethod: 'upi' },
      adminId,
    );
    expect(secondPay.paymentStatus).toBe('paid');

    del1Stat = await settlementService.getDebitSettlementStatus(tenantId, del1.transactionId!, db as any);
    expect(del1Stat.status).toBe('paid');
    expect(del1Stat.outstandingAmount).toBe(0);

    // 3. Create Delivery 2 (₹100) and Delivery 3 (₹100) on separate dates
    const d2 = await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: '2026-10-02',
        deliverySlot: 'morning',
        status: 'delivered',
      },
      adminId,
    );
    const d3 = await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: '2026-10-03',
        deliverySlot: 'morning',
        status: 'delivered',
      },
      adminId,
    );

    // 4. One single payment (₹150) settling multiple deliveries via FIFO (D2 fully settled, D3 partially settled)
    await recordPayment(tenantId, { userId, amount: 150, date: '2026-10-04', paymentMethod: 'online' }, adminId);

    const d2Stat = await settlementService.getDebitSettlementStatus(tenantId, d2.transactionId!, db as any);
    expect(d2Stat.status).toBe('paid');
    expect(d2Stat.outstandingAmount).toBe(0);

    const d3Stat = await settlementService.getDebitSettlementStatus(tenantId, d3.transactionId!, db as any);
    expect(d3Stat.status).toBe('partially_paid');
    expect(d3Stat.paidAmount).toBe(50);
    expect(d3Stat.outstandingAmount).toBe(50);

    // 5. Excess Advance Credit test: Customer pays ₹100 when only ₹50 is outstanding
    await recordPayment(tenantId, { userId, amount: 100, date: '2026-10-05', paymentMethod: 'online' }, adminId);

    const d3StatAfter = await settlementService.getDebitSettlementStatus(tenantId, d3.transactionId!, db as any);
    expect(d3StatAfter.status).toBe('paid');
    expect(d3StatAfter.outstandingAmount).toBe(0);

    // User account balance must reflect the -₹50 advance credit
    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(Number(userRow[0]!.accountBalance)).toBe(-50);
  });

  it('Req 3 & 4: Invoicing with previous balance, post-invoice payments, and historical line-item preservation', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { recordDeliveryOutcome } = await import('../../modules/deliveries/delivery.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { generateInvoice } = await import('../../shared/services/invoiceService.js');
    const { db } = await import('../../shared/db/client.js');
    const { invoices, invoiceLineItems } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Invoice Test Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Invoice Cust',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Ghee',
      category: 'ghee',
      variants: [{ label: '1kg', quantity: 1, unit: 'kg', price: 500, stock: 50 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    const sub = await createSubscription(
      tenantId,
      userId,
      {
        productId: product.id,
        variantId,
        quantityPerDelivery: 1,
        deliverySlot: 'morning',
        deliverySchedule: 'daily',
        startDate: '2026-09-01',
        pricePerPacket: 500,
      } as never,
      adminId,
    );

    // September Delivery 1 (₹500)
    await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: '2026-09-10',
        deliverySlot: 'morning',
        status: 'delivered',
      },
      adminId,
    );

    // Generate September Invoice
    const sepInv = await generateInvoice(tenantId, userId, 9, 2026, { force: true });
    expect(Number(sepInv.invoice.netAmountDue)).toBe(500);
    expect(sepInv.invoice.status).toBe('draft');

    // October Delivery 1 (₹500)
    await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: '2026-10-10',
        deliverySlot: 'morning',
        status: 'delivered',
      },
      adminId,
    );

    // Generate October Invoice: previousBalance must carry forward September ₹500
    const octInv = await generateInvoice(tenantId, userId, 10, 2026, { force: true });
    expect(Number(octInv.invoice.previousBalance)).toBe(500);
    expect(Number(octInv.invoice.totalCharges)).toBe(500);
    expect(Number(octInv.invoice.netAmountDue)).toBe(1000);

    // Record line item snapshot count
    const originalLines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, octInv.invoice.id));
    const originalLineCount = originalLines.length;

    // Post-invoice payment: Customer pays ₹1000 on Oct 20
    await recordPayment(tenantId, { userId, amount: 1000, date: '2026-10-20', paymentMethod: 'upi' }, adminId);

    // Verify October invoice status is updated to PAID without modifying line items
    const updatedOct = await db.select().from(invoices).where(eq(invoices.id, octInv.invoice.id)).limit(1);
    expect(updatedOct[0]!.status).toBe('paid');
    expect(Number(updatedOct[0]!.netAmountDue)).toBe(0);

    const postPayLines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, octInv.invoice.id));
    expect(postPayLines.length).toBe(originalLineCount);
  });

  it('Req 7: Real concurrent payment operations against PostgreSQL prevent over-settlement', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { db } = await import('../../shared/db/client.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Concurrency Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Concurrent Cust',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    // Create a single open debit of ₹200
    const debit = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: userId,
        txnType: 'delivery',
        entryType: 'debit',
        amount: 200,
        effectiveDate: '2026-10-01',
        description: 'Target debit for concurrency',
        createdById: adminId,
      },
      db as any,
    );

    // Launch 3 simultaneous payments of ₹100 each (Total ₹300 attempted against ₹200 debit)
    const p1 = recordPayment(tenantId, { userId, amount: 100, date: '2026-10-02', paymentMethod: 'cash' }, adminId);
    const p2 = recordPayment(tenantId, { userId, amount: 100, date: '2026-10-02', paymentMethod: 'upi' }, adminId);
    const p3 = recordPayment(tenantId, { userId, amount: 100, date: '2026-10-02', paymentMethod: 'online' }, adminId);

    await Promise.all([p1, p2, p3]);

    // Check settlement on debit: total settled MUST NOT exceed ₹200
    const debitStatus = await settlementService.getDebitSettlementStatus(tenantId, debit.id, db as any);
    expect(debitStatus.paidAmount).toBe(200);
    expect(debitStatus.outstandingAmount).toBe(0);
    expect(debitStatus.status).toBe('paid');
  });

  it('Req 6: Historical migration is genuinely idempotent and prevents over-allocation', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { migrateCustomerSettlements } = await import('../../modules/transactions/settlement.migration.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { db } = await import('../../shared/db/client.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Migration Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Migration Cust',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    // Create 1 historical debit (₹150)
    const debit = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: userId,
        txnType: 'delivery',
        entryType: 'debit',
        amount: 150,
        effectiveDate: '2026-08-01',
        description: 'Unsettled historical delivery',
        createdById: adminId,
      },
      db as any,
    );

    // Create 1 historical payment (₹150) without settlements
    await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: userId,
        txnType: 'payment',
        entryType: 'credit',
        amount: 150,
        effectiveDate: '2026-08-05',
        description: 'Unsettled historical payment',
        createdById: adminId,
      },
      db as any,
    );

    // First migration run: should allocate
    const stats1 = await migrateCustomerSettlements(tenantId, { customerId: userId });
    expect(stats1.totalFifoAllocated).toBeGreaterThanOrEqual(1);

    const debitStatus = await settlementService.getDebitSettlementStatus(tenantId, debit.id, db as any);
    expect(debitStatus.status).toBe('paid');
    expect(debitStatus.outstandingAmount).toBe(0);

    // Second migration run (idempotency check): should allocate 0 additional, no over-allocation
    const stats2 = await migrateCustomerSettlements(tenantId, { customerId: userId });
    expect(stats2.totalFifoAllocated).toBe(0);

    const debitStatusAfter = await settlementService.getDebitSettlementStatus(tenantId, debit.id, db as any);
    expect(debitStatusAfter.paidAmount).toBe(150);
  });
});

