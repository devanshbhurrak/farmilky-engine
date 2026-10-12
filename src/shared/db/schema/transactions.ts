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
import { products } from './products.js';
import { invoices } from './invoices.js';
import {
  entryTypeEnum,
  partyTypeEnum,
  transactionPaymentMethodEnum,
  transactionStatusEnum,
  transactionTypeEnum,
  txnReferenceTypeEnum,
} from './enums.js';

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    txnNumber: text('txn_number').notNull(),
    partyType: partyTypeEnum('party_type').notNull(),
    partyId: uuid('party_id'),
    txnType: transactionTypeEnum('txn_type').notNull(),
    txnCategory: text('txn_category'),
    entryType: entryTypeEnum('entry_type').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    effectiveDate: date('effective_date').notNull().defaultNow(),
    referenceType: txnReferenceTypeEnum('reference_type'),
    referenceId: uuid('reference_id'),
    paymentMethod: transactionPaymentMethodEnum('payment_method'),
    paymentRef: text('payment_ref'),
    receivedDate: date('received_date'),
    status: transactionStatusEnum('status').notNull().default('active'),
    // Manual confirmation flag for UPI/bank-transfer payments (see
    // PATCH /api/payments/:id/reconcile). Defaults to false.
    reconciled: boolean('reconciled').notNull().default(false),
    voidedByTxnId: uuid('voided_by_txn_id'),
    correctsTxnId: uuid('corrects_txn_id'),
    voidReason: text('void_reason'),
    description: text('description').notNull(),
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id),
    modifiedById: uuid('modified_by_id').references(() => users.id),
    modifiedAt: timestamp('modified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('txn_number_tenant_unique').on(t.tenantId, t.txnNumber),
    index('txn_party_idx').on(t.tenantId, t.partyType, t.partyId, t.effectiveDate),
    index('txn_ref_idx').on(t.tenantId, t.referenceType, t.referenceId),
    index('txn_date_type_idx').on(t.tenantId, t.effectiveDate, t.txnType),
    index('txn_category_idx').on(t.tenantId, t.txnCategory, t.effectiveDate),
    index('txn_corrects_idx').on(t.correctsTxnId),
    check('txn_amount_check', sql`${t.amount} > 0`),
    check('txn_party_id_check', sql`party_type = 'business' OR party_id IS NOT NULL`),
    check('txn_audit_trail_check', sql`status = 'active' OR (modified_by_id IS NOT NULL AND modified_at IS NOT NULL)`),
  ],
);

export const transactionItems = pgTable(
  'transaction_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    productId: uuid('product_id').references(() => products.id),
    productName: text('product_name'),
    variantLabel: text('variant_label'),
    quantity: numeric('quantity', { precision: 10, scale: 3 }),
    unit: text('unit'),
    rate: numeric('rate', { precision: 10, scale: 2 }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('txn_items_txn_idx').on(t.transactionId)],
);

export const invoiceAllocations = pgTable(
  'invoice_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoice_alloc_unique').on(t.transactionId, t.invoiceId),
    index('inv_alloc_txn_idx').on(t.transactionId),
    index('inv_alloc_inv_idx').on(t.invoiceId),
    check('inv_alloc_amount_check', sql`${t.amount} > 0`),
  ],
);

export const transactionSettlements = pgTable(
  'transaction_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    settlementTxnId: uuid('settlement_txn_id')
      .notNull()
      .references(() => transactions.id),
    settledTxnId: uuid('settled_txn_id')
      .notNull()
      .references(() => transactions.id),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('txn_settle_payment_idx').on(t.settlementTxnId),
    index('txn_settle_settled_idx').on(t.settledTxnId),
    check('txn_settle_amount_check', sql`${t.amount} > 0`),
  ],
);

export const transactionCounters = pgTable('transaction_counters', {
  id: text('id').primaryKey(),
  seq: integer('seq').notNull().default(0),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionItem = typeof transactionItems.$inferSelect;
export type InvoiceAllocation = typeof invoiceAllocations.$inferSelect;
export type TransactionSettlement = typeof transactionSettlements.$inferSelect;
