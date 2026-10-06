import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { isNull, sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { addressTypeEnum, agentAvailabilityEnum, timeSlotPrefEnum, userRoleEnum } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('customer'),
    profilePicUrl: text('profile_pic_url'),
    isEmailVerified: boolean('is_email_verified').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    accountBalance: numeric('account_balance', { precision: 12, scale: 2 }).notNull().default('0'),
    assignedAreaId: uuid('assigned_area_id'),
    deliverySequence: integer('delivery_sequence'),
    preferredTimeSlot: timeSlotPrefEnum('preferred_time_slot').default('morning'),
    defaultDeliveryNotes: text('default_delivery_notes'),
    createdById: uuid('created_by_id'),
    updatedById: uuid('updated_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_tenant_partial')
      .on(t.tenantId, t.email)
      .where(sql`${t.email} IS NOT NULL`),
    index('users_tenant_role_idx').on(t.tenantId, t.role),
    index('users_tenant_area_role_idx').on(t.tenantId, t.assignedAreaId, t.role),
    index('users_tenant_active_idx').on(t.tenantId, t.isActive),
  ],
);

export const agentProfiles = pgTable('agent_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id)
    .unique(),
  joiningDate: date('joining_date'),
  availability: agentAvailabilityEnum('availability').notNull().default('available'),
  vehicleType: text('vehicle_type'),
  maxCapacity: integer('max_capacity'),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  managedById: uuid('managed_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userAddresses = pgTable(
  'user_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    street: text('street'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    addressType: addressTypeEnum('address_type').notNull().default('home'),
    lat: numeric('lat', { precision: 10, scale: 7 }),
    lng: numeric('lng', { precision: 10, scale: 7 }),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_addresses_user_idx').on(t.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_expires_idx').on(t.expiresAt),
    index('refresh_tokens_active_idx').on(t.expiresAt).where(isNull(t.revokedAt)),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AgentProfile = typeof agentProfiles.$inferSelect;
export type UserAddress = typeof userAddresses.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
