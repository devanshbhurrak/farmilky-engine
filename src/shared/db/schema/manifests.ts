import {
  boolean,
  check,
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
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { areas } from './areas.js';
import {
  deliverySlotEnum,
  manifestEntryStatusEnum,
  manifestEntryTypeEnum,
  manifestStatusEnum,
} from './enums.js';

export const deliveryManifests = pgTable(
  'delivery_manifests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    manifestDate: date('manifest_date').notNull(),
    deliverySlot: deliverySlotEnum('delivery_slot').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => users.id),
    areaId: uuid('area_id')
      .notNull()
      .references(() => areas.id),
    status: manifestStatusEnum('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('manifests_date_slot_idx').on(t.tenantId, t.manifestDate, t.deliverySlot),
    index('manifests_agent_date_idx').on(t.tenantId, t.agentId, t.manifestDate),
    uniqueIndex('manifests_tenant_date_slot_area_unique').on(
      t.tenantId,
      t.manifestDate,
      t.deliverySlot,
      t.areaId,
    ),
  ],
);

export const manifestEntries = pgTable(
  'manifest_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    manifestId: uuid('manifest_id')
      .notNull()
      .references(() => deliveryManifests.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entryType: manifestEntryTypeEnum('entry_type').notNull(),
    referenceId: uuid('reference_id').notNull(),
    subscriptionId: uuid('subscription_id'),
    orderId: uuid('order_id'),
    customerId: uuid('customer_id').references(() => users.id),
    customerName: text('customer_name').notNull(),
    phone: text('phone'),
    address: text('address'),
    productLabel: text('product_label').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }),
    status: manifestEntryStatusEnum('status').notNull().default('pending'),
    sequence: integer('sequence'),
    proofUrl: text('proof_url'),
    deliveryNotes: text('delivery_notes'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    lat: numeric('lat', { precision: 10, scale: 7 }),
    lng: numeric('lng', { precision: 10, scale: 7 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('manifest_entries_seq_idx').on(t.manifestId, t.sequence),
    index('manifest_entries_customer_idx').on(t.customerId),
    index('manifest_entries_sub_idx').on(t.subscriptionId),
    check(
      'manifest_entry_ref_check',
      sql`(entry_type = 'subscription' AND subscription_id IS NOT NULL) OR (entry_type = 'order' AND order_id IS NOT NULL)`,
    ),
  ],
);

export type DeliveryManifest = typeof deliveryManifests.$inferSelect;
export type ManifestEntry = typeof manifestEntries.$inferSelect;
