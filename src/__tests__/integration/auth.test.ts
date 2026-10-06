import { describe, expect, it } from 'vitest';
import { dbOnly, tenantSlug } from './helpers.js';

dbOnly('auth flow – happy path', () => {
  it('register → login → refresh → logout → refresh rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');

    const slug = tenantSlug();
    const reg = await TenantService.register({
      name: 'Test Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: 'admin@test.local',
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });
    expect(reg.tenant.slug).toBe(slug);
    expect(reg.accessToken).toBeTruthy();

    const login = await AuthService.login({
      emailOrPhone: 'admin@test.local',
      password: 'password123',
      tenantSlug: slug,
    });
    expect(login.accessToken).toBeTruthy();
    expect(login.refreshToken).toBeTruthy();

    const refreshed = await AuthService.refresh(login.refreshToken);
    expect(refreshed.accessToken).toBeTruthy();
    // Rotated token should be different
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);

    // Old refresh token should be invalidated after rotation
    await expect(AuthService.refresh(login.refreshToken)).rejects.toThrow();

    // Logout revokes the new token
    await AuthService.logout(refreshed.refreshToken);
    await expect(AuthService.refresh(refreshed.refreshToken)).rejects.toThrow();
  });
});

dbOnly('auth flow – error cases', () => {
  it('login with wrong password is rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');

    const slug = tenantSlug();
    await TenantService.register({
      name: 'PW Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'correctpassword',
    });

    await expect(
      AuthService.login({
        emailOrPhone: `admin-${slug}@test.local`,
        password: 'wrongpassword',
        tenantSlug: slug,
      }),
    ).rejects.toThrow();
  });

  it('login with non-existent email is rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');

    const slug = tenantSlug();
    await TenantService.register({
      name: 'Ghost Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });

    await expect(
      AuthService.login({
        emailOrPhone: 'nobody@ghost.local',
        password: 'password123',
        tenantSlug: slug,
      }),
    ).rejects.toThrow();
  });

  it('login with wrong tenant slug is rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');

    const slug = tenantSlug();
    await TenantService.register({
      name: 'Slug Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });

    await expect(
      AuthService.login({
        emailOrPhone: `admin-${slug}@test.local`,
        password: 'password123',
        tenantSlug: 'does-not-exist-slug',
      }),
    ).rejects.toThrow();
  });

  it('duplicate tenant slug registration is rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');

    const slug = tenantSlug();
    await TenantService.register({
      name: 'First Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `first-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });

    await expect(
      TenantService.register({
        name: 'Second Dairy',
        slug, // same slug
        adminName: 'Admin2',
        adminEmail: `second-${slug}@test.local`,
        adminPhone: '9876543211',
        adminPassword: 'password123',
      }),
    ).rejects.toThrow();
  });

  it('duplicate email within same tenant is rejected', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');

    const slug = tenantSlug();
    await TenantService.register({
      name: 'DupEmail Dairy',
      slug,
      adminName: 'Admin',
      adminEmail: `admin-${slug}@test.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });

    // Register customer with same email as admin in same tenant
    await expect(
      AuthService.register({
        name: 'Dup',
        email: `admin-${slug}@test.local`,
        password: 'password123',
        tenantSlug: slug,
      } as never),
    ).rejects.toThrow();
  });

  it('refresh with tampered token is rejected', async () => {
    const { AuthService } = await import('../../modules/users/user.service.js');
    await expect(
      AuthService.refresh('definitely.not.a.valid.jwt'),
    ).rejects.toThrow();
  });

  it('refresh with empty string is rejected', async () => {
    const { AuthService } = await import('../../modules/users/user.service.js');
    await expect(AuthService.refresh('')).rejects.toThrow();
  });
});

dbOnly('auth flow – tenant isolation', () => {
  it('user registered in tenant A cannot log in under tenant B', async () => {
    const { TenantService } = await import('../../modules/tenants/tenant.service.js');
    const { AuthService } = await import('../../modules/users/user.service.js');

    const slugA = tenantSlug();
    const slugB = tenantSlug();

    await TenantService.register({
      name: 'Dairy A',
      slug: slugA,
      adminName: 'AdminA',
      adminEmail: `admin@dairy-a.local`,
      adminPhone: '9876543210',
      adminPassword: 'password123',
    });

    await TenantService.register({
      name: 'Dairy B',
      slug: slugB,
      adminName: 'AdminB',
      adminEmail: `admin@dairy-b.local`,
      adminPhone: '9876543211',
      adminPassword: 'password123',
    });

    // Register a customer in tenant A
    await AuthService.register({
      name: 'Alice',
      phone: '9000000001',
      password: 'password123',
      tenantSlug: slugA,
    } as never);

    // Alice's phone/email belongs to tenant A — should not be found under tenant B
    await expect(
      AuthService.login({
        emailOrPhone: '9000000001',
        password: 'password123',
        tenantSlug: slugB,
      }),
    ).rejects.toThrow();
  });
});

describe('auth (no db)', () => {
  it('placeholder passes without DATABASE_URL', () => {
    expect(true).toBe(true);
  });
});
