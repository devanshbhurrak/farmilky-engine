import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import {
  entryTypeEnum,
  generatedByTypeEnum,
  invoiceStatusEnum,
  lineItemCategoryEnum,
  sentViaChannelEnum,
} from './enums.js';

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    invoiceNumber: text('invoice_number').notNull(),
    billingMonth: smallint('billing_month').notNull(),
    billingYear: smallint('billing_year').notNull(),
    previousBalance: numeric('previous_balance', { precision: 12, scale: 2 }).notNull().default('0'),
    totalCharges: numeric('total_charges', { precision: 12, scale: 2 }).notNull().default('0'),
    orderCredits: numeric('order_credits', { precision: 12, scale: 2 }).notNull().default('0'),
    totalPayments: numeric('total_payments', { precision: 12, scale: 2 }).notNull().default('0'),
    totalAdjustments: numeric('total_adjustments', { precision: 12, scale: 2 }).notNull().default('0'),
    netAmountDue: numeric('net_amount_due', { precision: 12, scale: 2 }).notNull().default('0'),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    isEarlyBilling: boolean('is_early_billing').notNull().default(false),
    billingCutoffDate: date('billing_cutoff_date'),
    voidedByUserId: uuid('voided_by_user_id').references(() => users.id),
    replacedInvoiceId: uuid('replaced_invoice_id'),
    voidReason: text('void_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentVia: sentViaChannelEnum('sent_via'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    generatedBy: generatedByTypeEnum('generated_by').notNull().default('system'),
    generatedByUserId: uuid('generated_by_user_id').references(() => users.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_user_period_idx').on(t.tenantId, t.userId, t.billingYear, t.billingMonth),
    index('invoices_status_idx').on(t.tenantId, t.status),
    index('invoices_period_idx').on(t.tenantId, t.billingYear, t.billingMonth),
    check('invoices_month_check', sql`${t.billingMonth} >= 1 AND ${t.billingMonth} <= 12`),
    check('invoices_year_check', sql`${t.billingYear} >= 2020`),
  ],
);

export const invoiceCounters = pgTable('invoice_counters', {
  id: text('id').primaryKey(),
  seq: integer('seq').notNull().default(0),
});

export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date'),
    description: text('description').notNull(),
    category: lineItemCategoryEnum('category').notNull(),
    referenceId: uuid('reference_id'),
    referenceType: text('reference_type'),
    quantity: numeric('quantity', { precision: 10, scale: 3 }),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    productName: text('product_name'),
    variantLabel: text('variant_label'),
    unit: text('unit'),
    entryType: entryTypeEnum('entry_type').notNull(),
  },
  (t) => [index('inv_lines_inv_idx').on(t.invoiceId)],
);

export const invoiceProductSummary = pgTable(
  'invoice_product_summary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    productId: uuid('product_id'),
    productName: text('product_name').notNull(),
    variantLabel: text('variant_label'),
    unit: text('unit'),
    totalQuantity: numeric('total_quantity', { precision: 10, scale: 3 }).notNull().default('0'),
    avgRate: numeric('avg_rate', { precision: 10, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    outstandingAmount: numeric('outstanding_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  },
  (t) => [index('inv_summary_inv_idx').on(t.invoiceId)],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InvoiceProductSummary = typeof invoiceProductSummary.$inferSelect;
