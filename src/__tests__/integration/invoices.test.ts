import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

dbOnly('invoices flow', () => {
  it('period txns → invoice totals+status; force regen voids old; payment syncs to paid', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { generateInvoice, syncInvoiceStatusAfterPayment } = await import(
      '../../shared/services/invoiceService.js'
    );
    const { recordPayment } = await import('../../modules/payments/payment.service.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Inv Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Cust',
      phone: '9123456783',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const day = `${year}-${String(month).padStart(2, '0')}-05`;

    // 1. Create a delivery transaction for 1000
    await transactionService.createTransaction({
      tenantId,
      partyType: 'customer',
      partyId: userId,
      txnType: 'delivery',
      entryType: 'debit',
      amount: 1000,
      effectiveDate: day,
      description: 'Delivery',
      createdById: adminId,
    });

    // 2. Generate invoice → should be draft with netAmountDue = 1000
    const first = await generateInvoice(tenantId, userId, month, year, {
      generatedBy: 'admin',
      adminId,
    });
    expect(first.action).toBe('created');
    expect(Number((first.invoice as { netAmountDue: string }).netAmountDue)).toBe(1000);
    expect((first.invoice as { status: string }).status).toBe('draft');

    // 3. Generate again without force → returns skipped (no re-creation)
    const existing = await generateInvoice(tenantId, userId, month, year, {});
    expect(existing.action).toBe('skipped');
    expect((existing.invoice as { id: string }).id).toBe((first.invoice as { id: string }).id);

    // 4. Force regenerate → voids old, creates new
    const regen = await generateInvoice(tenantId, userId, month, year, {
      force: true,
      generatedBy: 'admin',
      adminId,
    });
    expect(regen.action).toBe('regenerated');
    expect((regen.invoice as { id: string }).id).not.toBe((first.invoice as { id: string }).id);

    // 5. Record full payment of 1000
    await recordPayment(
      tenantId,
      { userId, amount: 1000, paymentMethod: 'cash', receivedDate: day } as never,
      adminId,
    );

    // 6. Sync invoice status → should update to paid
    await syncInvoiceStatusAfterPayment(tenantId, userId);

    // 7. Generate again (no force) → returns now-updated existing invoice with status=paid
    const afterPayment = await generateInvoice(tenantId, userId, month, year, {});
    expect((afterPayment.invoice as { status: string }).status).toBe('paid');
    expect(Number((afterPayment.invoice as { netAmountDue: string }).netAmountDue)).toBe(0);
  });

  it('outstanding balance from prior month carries forward', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');
    const { generateInvoice, getPreviousBalance } = await import(
      '../../shared/services/invoiceService.js'
    );

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Carry Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'Cust',
      phone: '9123000002',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    // Create delivery in previous month (use month=1 so there's a clear prior month)
    const priorYear = 2025;
    const priorMonth = 11; // November 2025
    const priorDay = '2025-11-10';

    await transactionService.createTransaction({
      tenantId,
      partyType: 'customer',
      partyId: userId,
      txnType: 'delivery',
      entryType: 'debit',
      amount: 600,
      effectiveDate: priorDay,
      description: 'Prior delivery',
      createdById: adminId,
    });

    await generateInvoice(tenantId, userId, priorMonth, priorYear, {
      generatedBy: 'admin',
      adminId,
    });

    // Previous balance for December should be 600 (outstanding)
    const prev = await getPreviousBalance(tenantId, userId, 12, priorYear);
    expect(prev).toBe(600);
  });
});

describe('invoices (no db)', () => {
  it('placeholder passes without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});
