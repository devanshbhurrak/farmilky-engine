import { describe, expect, it } from 'vitest';
import { tenantSlug } from './helpers.js';
import { toDateOnlyString, istToday } from '../../shared/utils/dateUtils.js';

describe('Final Production Readiness & Accounting Verification Suite', () => {
  it('Area 1: Digital payment lifecycle (pending/reconciled, failed states, no phantom credit)', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment, reconcilePayment } = await import('../../modules/payments/payment.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { transactions, users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Digital Lifecycle Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'UPI Customer',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    // 1. Create debit (₹300)
    const debit = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'customer',
        partyId: userId,
        txnType: 'delivery',
        entryType: 'debit',
        amount: 300,
        effectiveDate: '2026-10-01',
        description: 'Delivery charge',
        createdById: adminId,
      },
      db as any,
    );

    // 2. Successful payment recorded via UPI (effective ledger credit)
    const upiPay = await recordPayment(
      tenantId,
      {
        userId,
        amount: 300,
        date: '2026-10-02',
        paymentMethod: 'upi',
        paymentRef: 'UPI-REF-998877',
      },
      adminId,
    );

    // Initially unreconciled
    expect(upiPay.reconciled).toBe(false);
    expect(upiPay.status).toBe('active');

    // Debit is settled to paid
    let dStat = await settlementService.getDebitSettlementStatus(tenantId, debit.id, db as any);
    expect(dStat.status).toBe('paid');

    // 3. Admin reconciles bank statement (distinct business event)
    const reconciled = await reconcilePayment(upiPay.id, tenantId, adminId);
    expect(reconciled.reconciled).toBe(true);

    // 4. Failed/Voided payment: customer bank reversed/failed
    await transactionService.voidTransaction(upiPay.id, tenantId, 'UPI bank chargeback/failure', adminId);

    // Check transaction status is voided
    const voidedTxn = await db.select().from(transactions).where(eq(transactions.id, upiPay.id)).limit(1);
    expect(voidedTxn[0]!.status).toBe('voided');

    // Customer balance must be debited back (+300)
    const uRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(Number(uRow[0]!.accountBalance)).toBe(300);

    // Debit is back to unpaid (no phantom credit left)
    dStat = await settlementService.getDebitSettlementStatus(tenantId, debit.id, db as any);
    expect(dStat.status).toBe('unpaid');
    expect(dStat.outstandingAmount).toBe(300);
  });

  it('Area 2: Reversal idempotency, delivery cancellations and audit-safe refund entries', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { recordDeliveryOutcome, cancelDelivery, correctDelivery } = await import('../../modules/deliveries/delivery.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { settlementService } = await import('../../modules/transactions/settlement.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { transactionSettlements, users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Reversal Idempotency Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Audit Cust',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Milk A2',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 80, stock: 50 }],
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
        pricePerPacket: 80,
      } as never,
      adminId,
    );

    // 1. Deliver with on-the-spot payment of ₹80
    const del = await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: today,
        deliverySlot: 'morning',
        status: 'delivered',
        paymentReceived: { amount: 80, paymentMethod: 'cash' },
      },
      adminId,
    );

    // 2. Cancel delivery: reverses charge, dissolves settlements
    await cancelDelivery(tenantId, del.delivery.id, { reason: 'Defective bottle returned' }, adminId);

    // Settlement must be marked reversed
    const setts = await db
      .select()
      .from(transactionSettlements)
      .where(eq(transactionSettlements.settledTxnId, del.transactionId!));
    expect(setts.length).toBe(1);
    expect(setts[0]!.status).toBe('reversed');

    // Customer has credit of ₹80 (paid for delivery that was cancelled and refunded to credit)
    const uRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(Number(uRow[0]!.accountBalance)).toBe(-80);

    // 3. Repeated void on already voided transaction throws standard 400 (idempotent / non-destructive)
    await expect(
      transactionService.voidTransaction(del.transactionId!, tenantId, 'Duplicate void', adminId),
    ).rejects.toThrow();
  });

  it('Area 3: Multiple partial payments on an invoice followed by full settlement', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { createSubscription } = await import('../../modules/subscriptions/subscription.service.js');
    const { recordDeliveryOutcome } = await import('../../modules/deliveries/delivery.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { generateInvoice } = await import('../../shared/services/invoiceService.js');
    const { db } = await import('../../shared/db/client.js');
    const { invoices } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Partial Inv Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Partial Cust',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Butter',
      category: 'butter',
      variants: [{ label: '500g', quantity: 1, unit: 'g', price: 300, stock: 50 }],
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
        startDate: '2026-10-01',
        pricePerPacket: 300,
      } as never,
      adminId,
    );

    // Delivery of ₹300
    await recordDeliveryOutcome(
      tenantId,
      {
        customerId: userId,
        type: 'subscription',
        referenceType: 'subscription',
        referenceId: sub.id,
        deliveryDate: '2026-10-05',
        deliverySlot: 'morning',
        status: 'delivered',
      },
      adminId,
    );

    // Generate Invoice for October (Net: ₹300)
    const gen = await generateInvoice(tenantId, userId, 10, 2026, { force: true });
    expect(Number(gen.invoice.netAmountDue)).toBe(300);

    // Partial Payment 1: ₹100
    await recordPayment(tenantId, { userId, amount: 100, date: '2026-10-15', paymentMethod: 'cash' }, adminId);

    let inv = await db.select().from(invoices).where(eq(invoices.id, gen.invoice.id)).limit(1);
    expect(inv[0]!.status).toBe('partially_paid');
    expect(Number(inv[0]!.netAmountDue)).toBe(200);

    // Partial Payment 2: ₹100
    await recordPayment(tenantId, { userId, amount: 100, date: '2026-10-18', paymentMethod: 'upi' }, adminId);

    inv = await db.select().from(invoices).where(eq(invoices.id, gen.invoice.id)).limit(1);
    expect(inv[0]!.status).toBe('partially_paid');
    expect(Number(inv[0]!.netAmountDue)).toBe(100);

    // Full final settlement: ₹100
    await recordPayment(tenantId, { userId, amount: 100, date: '2026-10-25', paymentMethod: 'online' }, adminId);

    inv = await db.select().from(invoices).where(eq(invoices.id, gen.invoice.id)).limit(1);
    expect(inv[0]!.status).toBe('paid');
    expect(Number(inv[0]!.netAmountDue)).toBe(0);
    expect(inv[0]!.paidAt).not.toBeNull();
  });

  it('Area 5: Global Accounting Invariant reconciliation test', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { transactions, transactionSettlements, users } = await import('../../shared/db/schema/index.js');
    const { and, eq, sql } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Invariant Test Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Invariant Cust',
      phone: `9${Date.now()}${Math.floor(Math.random() * 1e5)}`,
      password: 'password123',
      tenantSlug: slug,
    } as never);
    const userId = cust.user.id as string;

    // Post debits
    await transactionService.createTransaction(
      { tenantId, partyType: 'customer', partyId: userId, txnType: 'delivery', entryType: 'debit', amount: 450, effectiveDate: '2026-10-01', description: 'Del 1', createdById: adminId },
      db as any,
    );
    await transactionService.createTransaction(
      { tenantId, partyType: 'customer', partyId: userId, txnType: 'delivery', entryType: 'debit', amount: 550, effectiveDate: '2026-10-02', description: 'Del 2', createdById: adminId },
      db as any,
    );

    // Post credit
    await recordPayment(tenantId, { userId, amount: 600, date: '2026-10-05', paymentMethod: 'cash' }, adminId);

    // Invariant 1: Customer Account Balance == Total Active Debits - Total Active Credits
    const debitsTotal = await db
      .select({ sum: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.partyId, userId), eq(transactions.entryType, 'debit'), eq(transactions.status, 'active')));
    const creditsTotal = await db
      .select({ sum: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.partyId, userId), eq(transactions.entryType, 'credit'), eq(transactions.status, 'active')));

    const expectedBalance = Number(debitsTotal[0]!.sum) - Number(creditsTotal[0]!.sum);
    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(Number(userRow[0]!.accountBalance)).toBe(expectedBalance);
    expect(expectedBalance).toBe(400); // 1000 debits - 600 credits = 400

    // Invariant 2: Total Active Settlements == 600 (450 on Del 1, 150 on Del 2)
    const settTotal = await db
      .select({ sum: sql<string>`coalesce(sum(${transactionSettlements.amount}), 0)` })
      .from(transactionSettlements)
      .where(and(eq(transactionSettlements.tenantId, tenantId), eq(transactionSettlements.status, 'active')));
    expect(Number(settTotal[0]!.sum)).toBe(600);
  });
});

