import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export interface TenantSettings {
  /** Return window in milliseconds (default 24h). */
  returnWindowMs?: number;
  /** Maximum vacation length in days (default 90). */
  vacationMaxDays?: number;
}

export const DEFAULT_TENANT_SETTINGS: Required<TenantSettings> = {
  returnWindowMs: 24 * 60 * 60 * 1000,
  vacationMaxDays: 90,
};

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  brandPhone: text('brand_phone'),
  upiId: text('upi_id'),
  upiName: text('upi_name'),
  brandLogoUrl: text('brand_logo_url'),
  backendUrl: text('backend_url'),
  // Per-tenant business-rule overrides; missing keys fall back to
  // DEFAULT_TENANT_SETTINGS.
  tenantSettings: jsonb('tenant_settings').$type<TenantSettings>().notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
