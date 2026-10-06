import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { contactStatusEnum } from './enums.js';

export const contactMessages = pgTable(
  'contact_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    message: text('message').notNull(),
    status: contactStatusEnum('status').notNull().default('unread'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contact_tenant_status_idx').on(t.tenantId, t.status, t.createdAt)],
);

export type ContactMessage = typeof contactMessages.$inferSelect;
