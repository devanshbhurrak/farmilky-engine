import { expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

dbOnly('orders flow', () => {
  it('stock 5 → order 3 → stock 2 → cancel → stock 5 → order 6 rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');
    const { createProduct } = await import('../../modules/products/product.service.js');
    const { addItem } = await import('../../modules/cart/cart.service.js');
    const { createOrderFromCart, cancelOrder } = await import('../../modules/orders/order.service.js');
    const { db } = await import('../../shared/db/client.js');
    const { productVariants } = await import('../../shared/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Order Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    const tenantId = reg.tenant.id;

    const cust = await AuthService.register({
      name: 'Cust',
      phone: '9123456780',
      password: 'password123',
      tenantSlug: slug,
    });
    const userId = cust.user.id as string;

    const product = await createProduct(tenantId, {
      name: 'Milk',
      category: 'milk',
      variants: [{ label: '1L', quantity: 1, unit: 'L', price: 60, stock: 5 }],
    } as never);
    const variantId = (product.variants as Array<{ id: string }>)[0].id;

    const stockOf = async () => {
      const rows = await db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
      return rows[0]?.stock ?? -1;
    };

    await addItem(tenantId, userId, { productId: product.id, variantId, quantity: 3 });
    const { order } = await createOrderFromCart(tenantId, userId, { paymentMethod: 'COD', billingMode: 'pay_at_delivery' });
    expect(order.totalAmount).toBeTruthy();
    expect(await stockOf()).toBe(2);

    await cancelOrder(tenantId, order.id, userId, false, 'changed mind');
    expect(await stockOf()).toBe(5);

    await addItem(tenantId, userId, { productId: product.id, variantId, quantity: 6 });
    await expect(createOrderFromCart(tenantId, userId, { paymentMethod: 'COD', billingMode: 'pay_at_delivery' })).rejects.toThrow();
  });
});

import { describe } from 'vitest';
describe('orders (no db)', () => {
  it('placeholder passes without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});


