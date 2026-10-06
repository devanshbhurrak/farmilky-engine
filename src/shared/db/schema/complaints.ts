import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { complaintCategoryEnum, complaintRefTypeEnum, complaintStatusEnum } from './enums.js';

export const complaints = pgTable(
  'complaints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    relatedTo: complaintCategoryEnum('related_to').notNull(),
    referenceId: uuid('reference_id'),
    referenceType: complaintRefTypeEnum('reference_type'),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    status: complaintStatusEnum('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: uuid('resolved_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('complaints_user_idx').on(t.tenantId, t.userId, t.createdAt),
    index('complaints_status_idx').on(t.tenantId, t.status),
  ],
);

export type Complaint = typeof complaints.$inferSelect;
