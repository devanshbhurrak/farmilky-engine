import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    pincodes: text('pincodes').array().notNull().default([]),
    localities: text('localities').array().notNull().default([]),
    assignedAgentId: uuid('assigned_agent_id').references(() => users.id),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('areas_tenant_active_idx').on(t.tenantId, t.isActive),
    index('areas_agent_idx').on(t.assignedAgentId),
  ],
);

export type Area = typeof areas.$inferSelect;
export type NewArea = typeof areas.$inferInsert;
