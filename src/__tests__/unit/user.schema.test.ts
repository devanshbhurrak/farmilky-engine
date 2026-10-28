import { describe, expect, it } from 'vitest';
import {
  adminCreateUserSchema,
  adminListQuerySchema,
  adminUpdateUserSchema,
} from '../../modules/users/user.schema.js';

describe('admin user list validation', () => {
  it('accepts supported customer filters and sort options', () => {
    const result = adminListQuerySchema.safeParse({
      role: 'customer',
      isActive: 'false',
      balance: 'non_positive',
      sortBy: 'accountBalance',
      sortOrder: 'desc',
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsupported balance and sort values', () => {
    expect(adminListQuerySchema.safeParse({ balance: 'due' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ sortBy: 'unsafe-column' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ sortOrder: 'random' }).success).toBe(false);
  });

  it('validates customer addresses and accepts empty values for clearing', () => {
    const create = adminCreateUserSchema.safeParse({
      name: 'Customer',
      phone: '9000000001',
      password: 'Password123',
      role: 'customer',
      address: { street: '12 Dairy Road', city: 'Pune', pincode: '411001' },
    });
    const clear = adminUpdateUserSchema.safeParse({
      address: { street: '', city: '', pincode: '' },
    });
    const invalidPincode = adminUpdateUserSchema.safeParse({
      address: { pincode: '123' },
    });

    expect(create.success).toBe(true);
    expect(clear.success).toBe(true);
    expect(invalidPincode.success).toBe(false);
  });
});
