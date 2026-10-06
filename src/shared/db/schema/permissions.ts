import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { deliveryRoleEnum } from './enums.js';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    role: deliveryRoleEnum('role').notNull(),
    permissions: text('permissions').array().notNull().default([]),
    updatedById: uuid('updated_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('role_perms_tenant_role_idx').on(t.tenantId, t.role)],
);

export type RolePermission = typeof rolePermissions.$inferSelect;
