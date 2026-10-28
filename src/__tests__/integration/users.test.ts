import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

dbOnly('admin customer workflows', () => {
  it('persists, updates, and clears customer addresses and applies list filters', async () => {
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService, UserService } = await import('../../modules/users/user.service.js');

    const slug = tenantSlug();
    const registration = await TenantService.register({
      name: 'Customer Workflow Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'Password123',
    });
    const admin = await AuthService.login({
      emailOrPhone: `admin-${slug}@test.local`,
      password: 'Password123',
      tenantSlug: slug,
    });

    const beta = await UserService.createAdminUser(registration.tenant.id, admin.user.id, {
      name: 'Beta Customer',
      phone: '9000000001',
      password: 'Password123',
      role: 'customer',
      address: { street: '12 Dairy Road', city: 'Pune', pincode: '411001' },
    });
    const alpha = await UserService.createAdminUser(registration.tenant.id, admin.user.id, {
      name: 'Alpha Customer',
      phone: '9000000002',
      password: 'Password123',
      role: 'customer',
    });
    await db
      .update(users)
      .set({ accountBalance: '25.00' })
      .where(and(eq(users.id, beta.id), eq(users.tenantId, registration.tenant.id)));

    const detail = await UserService.getAdminDetail(registration.tenant.id, beta.id);
    expect(detail.user.addresses).toMatchObject([
      { street: '12 Dairy Road', city: 'Pune', pincode: '411001' },
    ]);

    const dueCustomers = await UserService.listAdmin(registration.tenant.id, {
      role: 'customer',
      balance: 'positive',
      sortBy: 'accountBalance',
      sortOrder: 'desc',
    });
    expect(dueCustomers.items.map((customer) => customer.name)).toEqual(['Beta Customer']);

    const sortedCustomers = await UserService.listAdmin(registration.tenant.id, {
      role: 'customer',
      balance: 'non_positive',
      sortBy: 'name',
      sortOrder: 'asc',
    });
    expect(sortedCustomers.items.map((customer) => customer.name)).toEqual(['Alpha Customer']);

    await UserService.updateAdminUser(registration.tenant.id, beta.id, {
      address: { street: '14 Dairy Road', city: 'Pune', pincode: '411002' },
    });
    const updated = await UserService.getAdminDetail(registration.tenant.id, beta.id);
    expect(updated.user.addresses).toMatchObject([
      { street: '14 Dairy Road', city: 'Pune', pincode: '411002' },
    ]);

    await UserService.updateAdminUser(registration.tenant.id, beta.id, {
      address: { street: '', city: '', pincode: '' },
    });
    const cleared = await UserService.getAdminDetail(registration.tenant.id, beta.id);
    expect(cleared.user.addresses).toEqual([]);
  });
});
