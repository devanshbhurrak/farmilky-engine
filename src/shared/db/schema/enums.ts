import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'customer',
  'admin',
  'delivery',
  'delivery_partner',
  'agent',
  'supplier',
]);

export const deliverySlotEnum = pgEnum('delivery_slot', ['morning', 'evening']);

export const deliveryScheduleEnum = pgEnum('delivery_schedule', [
  'daily',
  'alternate',
  'weekly',
  'custom',
]);

export const deliveryOutcomeEnum = pgEnum('delivery_outcome', [
  'pending',
  'delivered',
  'skipped',
  'partial',
  'extra',
  'failed',
  'missed',
]);

export const deliveryTypeEnum = pgEnum('delivery_type', ['subscription', 'order', 'instant']);

export const deliveryPaymentModeEnum = pgEnum('delivery_payment_mode', [
  'pay_at_delivery',
  'subscription_ledger',
  'prepaid',
]);

export const deliveryPaymentStatusEnum = pgEnum('delivery_payment_status', [
  'pending',
  'paid',
  'partially_paid',
  'failed',
]);

export const transactionTypeEnum = pgEnum('transaction_type', [
  'delivery',
  'order',
  'payment',
  'credit_adjustment',
  'debit_adjustment',
  'return_refund',
  'opening_balance',
  'milk_collection',
  'supplier_payment',
  'supplier_adjustment',
  'expense',
]);

export const transactionStatusEnum = pgEnum('transaction_status', ['active', 'voided', 'deleted']);

export const transactionPaymentMethodEnum = pgEnum('transaction_payment_method', [
  'cash',
  'upi',
  'bank_transfer',
  'card',
  'online',
  'COD',
]);

export const entryTypeEnum = pgEnum('entry_type', ['debit', 'credit']);

export const partyTypeEnum = pgEnum('party_type', ['customer', 'supplier', 'business']);

export const txnReferenceTypeEnum = pgEnum('txn_reference_type', [
  'subscription_delivery',
  'delivery',
  'order',
  'milk_collection',
  'return',
  'invoice',
  'manual',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'sent',
  'paid',
  'partially_paid',
  'overdue',
  'cancelled',
  'void',
]);

export const orderStatusEnum = pgEnum('order_status', ['placed', 'confirmed', 'delivered', 'cancelled']);

export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'paid', 'failed']);

export const billingModeEnum = pgEnum('billing_mode', ['pay_at_delivery', 'subscription_ledger']);

export const paymentMethodEnum = pgEnum('payment_method', ['COD', 'online']);

export const returnStatusEnum = pgEnum('return_status', ['requested', 'approved', 'rejected', 'completed']);

export const productCategoryEnum = pgEnum('product_category', [
  'milk',
  'ghee',
  'paneer',
  'curd',
  'butter',
  'cheese',
  'other',
]);

export const measurementUnitEnum = pgEnum('measurement_unit', ['L', 'ml', 'kg', 'g', 'unit']);

export const manifestStatusEnum = pgEnum('manifest_status', ['draft', 'active', 'completed']);

export const manifestEntryTypeEnum = pgEnum('manifest_entry_type', ['subscription', 'order']);

export const manifestEntryStatusEnum = pgEnum('manifest_entry_status', [
  'pending',
  'delivered',
  'failed',
  'skipped',
]);

export const complaintStatusEnum = pgEnum('complaint_status', ['open', 'in_progress', 'resolved', 'closed']);

export const complaintCategoryEnum = pgEnum('complaint_category', [
  'order',
  'subscription',
  'delivery',
  'product',
  'other',
]);

export const complaintRefTypeEnum = pgEnum('complaint_ref_type', [
  'order',
  'subscription',
  'delivery_manifest',
  'product',
]);

export const agentAvailabilityEnum = pgEnum('agent_availability', ['available', 'busy', 'offline']);

export const addressTypeEnum = pgEnum('address_type', ['home', 'work', 'other']);

export const timeSlotPrefEnum = pgEnum('time_slot_pref', ['morning', 'evening', 'anytime']);

export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'paused', 'cancelled']);

export const subscriptionChangeTypeEnum = pgEnum('subscription_change_type', [
  'created',
  'quantity',
  'price',
  'schedule',
  'variant',
  'status',
  'slot',
  'scheduled_change_applied',
  'delivery',
  'correction',
]);

export const deliveryAttemptStatusEnum = pgEnum('delivery_attempt_status', [
  'delivered',
  'failed',
  'skipped',
]);

export const collectionSessionEnum = pgEnum('collection_session', ['morning', 'evening']);

export const collectionStatusEnum = pgEnum('collection_status', ['pending', 'confirmed']);

export const deliveryRoleEnum = pgEnum('delivery_role', ['delivery', 'delivery_partner', 'agent']);

export type DeliveryRole = (typeof deliveryRoleEnum.enumValues)[number];

export const contactStatusEnum = pgEnum('contact_status', ['unread', 'read', 'replied']);

export const lineItemCategoryEnum = pgEnum('line_item_category', [
  'subscription_delivery',
  'order',
  'payment',
  'adjustment',
  'credit',
]);

export const generatedByTypeEnum = pgEnum('generated_by_type', ['system', 'admin']);

export const sentViaChannelEnum = pgEnum('sent_via_channel', ['whatsapp', 'email', 'manual']);
