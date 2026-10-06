import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

dbOnly('transactions flow', () => {
  it('delivery debit raises balance; payment lowers it; void reverts; edit corrects; delete zeroes', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment, updatePayment, deletePayment } = await import('../../modules/payments/payment.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const { toDateOnlyString } = await import('../../shared/utils/dateUtils.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Txn Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const today = toDateOnlyString(new Date());

    const cust = await AuthService.register({
      name: 'Cust',
      phone: '9123456781',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const balanceOf = async () => {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return Number(rows[0]?.accountBalance ?? NaN);
    };

    // 1. Delivery debit of 500 → customer owes 500
    await transactionService.createTransaction({
      tenantId,
      partyType: 'customer',
      partyId: userId,
      txnType: 'delivery',
      entryType: 'debit',
      amount: 500,
      effectiveDate: today,
      description: 'Test delivery',
      createdById: adminId,
    });
    expect(await balanceOf()).toBe(500);

    // 2. Payment of 200 → balance 300
    const payment = await recordPayment(
      tenantId,
      { userId, amount: 200, paymentMethod: 'cash', receivedDate: today } as never,
      adminId,
    );
    expect(await balanceOf()).toBe(300);

    // 3. Void the payment → back to 500; voided transaction must not be active
    await transactionService.voidTransaction(
      (payment as { id: string }).id,
      tenantId,
      'test void',
      adminId,
    );
    expect(await balanceOf()).toBe(500);

    // 4. New payment of 200, then edit to 250 → balance should be 500-250 = 250
    //    updatePayment returns the NEW (corrected) transaction, not the voided original
    const payment2 = await recordPayment(
      tenantId,
      { userId, amount: 200, paymentMethod: 'cash', receivedDate: today } as never,
      adminId,
    );
    expect(await balanceOf()).toBe(300); // 500-200

    const corrected = await updatePayment(
      (payment2 as { id: string }).id,
      tenantId,
      { void_reason: 'correction', amount: 250 } as never,
      adminId,
    );
    expect(await balanceOf()).toBe(250); // 500-250

    // 5. Delete the CORRECTED transaction (not the voided payment2) → balance back to 500
    const correctedId = (corrected as { id: string }).id;
    await deletePayment(
      correctedId,
      tenantId,
      { void_reason: 'test delete' } as never,
      adminId,
    );
    expect(await balanceOf()).toBe(500);
  });

  it('cannot void an already-voided transaction', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { toDateOnlyString } = await import('../../shared/utils/dateUtils.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'DblVoid Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const today = toDateOnlyString(new Date());

    const cust = await AuthService.register({
      name: 'Cust',
      phone: '9876541000',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const payment = await recordPayment(
      tenantId,
      { userId, amount: 100, paymentMethod: 'cash', receivedDate: today } as never,
      adminId,
    );
    const txnId = (payment as { id: string }).id;

    await transactionService.voidTransaction(txnId, tenantId, 'first void', adminId);

    // Second void on an already-voided transaction should throw
    await expect(
      transactionService.voidTransaction(txnId, tenantId, 'second void', adminId),
    ).rejects.toThrow();
  });

  it('balance delta is symmetric: debit then matching credit nets to zero', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { recordPayment } = await import('../../modules/payments/payment.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const { toDateOnlyString } = await import('../../shared/utils/dateUtils.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Sym Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;
    const today = toDateOnlyString(new Date());

    const cust = await AuthService.register({
      name: 'Cust',
      phone: '9123000001',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const balanceOf = async () => {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return Number(rows[0]?.accountBalance ?? NaN);
    };

    expect(await balanceOf()).toBe(0);

    await transactionService.createTransaction({
      tenantId,
      partyType: 'customer',
      partyId: userId,
      txnType: 'delivery',
      entryType: 'debit',
      amount: 300,
      effectiveDate: today,
      description: 'Delivery',
      createdById: adminId,
    });
    expect(await balanceOf()).toBe(300);

    await recordPayment(
      tenantId,
      { userId, amount: 300, paymentMethod: 'upi', receivedDate: today } as never,
      adminId,
    );
    expect(await balanceOf()).toBe(0);
  });
});

describe('transactions (no db)', () => {
  it('placeholder passes without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});
