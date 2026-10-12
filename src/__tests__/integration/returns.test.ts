import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

dbOnly('returns flow', () => {
  it('request return on delivered order → approve → refund transaction created → balance decreases', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { addItem } = await import('../../modules/cart/cart.service.js');
    const { createOrderFromCart, recordDeliveryOutcome } = await import('../../modules/orders/order.service.js');
    const { requestReturn, updateStatus } = await import('../../modules/returns/return.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { users } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    const { toDateOnlyString, istToday } = await import('../../shared/utils/dateUtils.js');
    const { transactionService } = await import('../../modules/transactions/transaction.service.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Returns Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'RetCust',
      phone: '9123000010',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 80, stock: 50 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    const balanceOf = async () => {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return Number(rows[0]?.accountBalance ?? NaN);
    };

    // Place and deliver order
    await addItem(tenantId, userId, { productId: product.id, variantId, quantity: 2 });
    const { order } = await createOrderFromCart(tenantId, userId, {
      paymentMethod: 'COD',
      billingMode: 'pay_at_delivery',
    });
    const today = toDateOnlyString(istToday());

    // Record delivery outcome to mark as delivered → should create debit transaction
    await recordDeliveryOutcome(tenantId, order.id, { status: 'delivered' }, adminId);

    const balanceAfterDelivery = await balanceOf();
    expect(balanceAfterDelivery).toBeGreaterThan(0); // debit was created

    // Request return for all items
    const orderItems = (order as { items?: Array<{ id: string; quantity: number }> }).items;
    const items = orderItems?.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) ?? [];
    const ret = await requestReturn(tenantId, userId, {
      orderId: order.id,
      reason: 'Wrong product delivered',
      items,
    });
    expect((ret as { status: string }).status).toBe('requested');

    // Approve return with refund
    const refundAmt = 160; // 2 × 80
    const approved = await updateStatus(tenantId, (ret as { id: string }).id, adminId, {
      status: 'approved',
      refundAmount: refundAmt,
    });
    expect((approved as { status: string }).status).toBe('approved');
    expect(approved.refundTransaction).toBeTruthy();

    // Balance should decrease by refund amount
    const balanceAfterRefund = await balanceOf();
    expect(balanceAfterRefund).toBe(balanceAfterDelivery - refundAmt);
  });

  it('return request rejected after 24-hour window', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { addItem } = await import('../../modules/cart/cart.service.js');
    const { createOrderFromCart } = await import('../../modules/orders/order.service.js');
    const { requestReturn } = await import('../../modules/returns/return.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { orders } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Window Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;

    const cust = await AuthService.register({
      name: 'WinCust',
      phone: '9123000011',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 80, stock: 50 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    await addItem(tenantId, userId, { productId: product.id, variantId, quantity: 1 });
    const { order } = await createOrderFromCart(tenantId, userId, {
      paymentMethod: 'COD',
      billingMode: 'pay_at_delivery',
    });

    // Manually set order as delivered with deliveredAt = 25 hours ago (outside window)
    const pastDelivery = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .update(orders)
      .set({ orderStatus: 'delivered', deliveredAt: pastDelivery })
      .where(eq(orders.id, order.id));

    const orderItems = (order as { items?: Array<{ id: string; quantity: number }> }).items;
    const items = orderItems?.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) ?? [];

    await expect(
      requestReturn(tenantId, userId, {
        orderId: order.id,
        reason: 'Late return',
        items,
      }),
    ).rejects.toThrow();
  });

  it('duplicate return for same order is rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { addItem } = await import('../../modules/cart/cart.service.js');
    const { createOrderFromCart, recordDeliveryOutcome } = await import('../../modules/orders/order.service.js');
    const { requestReturn } = await import('../../modules/returns/return.service.js');
    const { toDateOnlyString, istToday } = await import('../../shared/utils/dateUtils.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'DupRet Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'DupCust',
      phone: '9123000012',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 80, stock: 50 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    await addItem(tenantId, userId, { productId: product.id, variantId, quantity: 1 });
    const { order } = await createOrderFromCart(tenantId, userId, {
      paymentMethod: 'COD',
      billingMode: 'pay_at_delivery',
    });
    const today = toDateOnlyString(istToday());
    await recordDeliveryOutcome(tenantId, order.id, { status: 'delivered' }, adminId);

    const orderItems = (order as { items?: Array<{ id: string; quantity: number }> }).items;
    const items = orderItems?.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) ?? [];

    await requestReturn(tenantId, userId, { orderId: order.id, reason: 'First', items });

    // Second return for same order should throw
    await expect(
      requestReturn(tenantId, userId, { orderId: order.id, reason: 'Duplicate', items }),
    ).rejects.toThrow();
  });

  it('approve requires refundAmount > 0', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { addItem } = await import('../../modules/cart/cart.service.js');
    const { createOrderFromCart, recordDeliveryOutcome } = await import('../../modules/orders/order.service.js');
    const { requestReturn, updateStatus } = await import('../../modules/returns/return.service.js');
    const { toDateOnlyString, istToday } = await import('../../shared/utils/dateUtils.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'NoAmt Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;
    const adminId = (reg.admin as { id: string }).id;

    const cust = await AuthService.register({
      name: 'NoAmtCust',
      phone: '9123000013',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 80, stock: 50 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    await addItem(tenantId, userId, { productId: product.id, variantId, quantity: 1 });
    const { order } = await createOrderFromCart(tenantId, userId, {
      paymentMethod: 'COD',
      billingMode: 'pay_at_delivery',
    });
    const today = toDateOnlyString(istToday());
    await recordDeliveryOutcome(tenantId, order.id, { status: 'delivered' }, adminId);

    const orderItems = (order as { items?: Array<{ id: string; quantity: number }> }).items;
    const items = orderItems?.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) ?? [];
    const ret = await requestReturn(tenantId, userId, {
      orderId: order.id,
      reason: 'Test',
      items,
    });

    // Approving without refundAmount should throw
    await expect(
      updateStatus(tenantId, (ret as { id: string }).id, adminId, {
        status: 'approved',
        refundAmount: 0,
      }),
    ).rejects.toThrow();
  });
});

describe('returns (no db)', () => {
  it('placeholder passes without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});
