import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { withTransaction, type DrizzleTx } from '../db/transaction.js';
import {
  invoices,
  tenants,
  transactionItems,
  users,
  type TransactionItem,
} from '../db/schema/index.js';
import type { DBOrTx } from '../types/index.js';
import { generateInvoiceNumber } from '../utils/invoiceNumber.js';
import { istToday, round2, toDateOnlyString } from '../utils/dateUtils.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { findActiveByPartyAndPeriod } from '../../modules/transactions/transaction.repository.js';
import * as invoiceRepo from '../../modules/invoices/invoice.repository.js';
import type { InvoiceStatus } from '../../modules/invoices/invoice.repository.js';

export interface GenerateInvoiceOptions {
  force?: boolean;
  isEarlyBilling?: boolean;
  /** Inclusive end date (YYYY-MM-DD) for early billing; defaults to last day of month. */
  billingCutoffDate?: string;
  adminId?: string;
  generatedBy?: 'system' | 'admin';
  generatedByUserId?: string;
  notes?: string;
}

export interface BulkInvoiceOptions {
  force?: boolean;
  isEarlyBilling?: boolean;
  billingCutoffDate?: string;
  adminId?: string;
  generatedBy?: 'system' | 'admin';
  generatedByUserId?: string;
  notes?: string;
}

export function lastDayOfMonth(year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return `${year}-${mm}-${String(last).padStart(2, '0')}`;
}

function mapLineCategory(txnType: string): invoiceRepo.InvoiceLineItemInput['category'] {
  if (txnType === 'delivery') return 'subscription_delivery';
  if (txnType === 'order') return 'order';
  if (txnType === 'payment') return 'payment';
  if (txnType === 'debit_adjustment' || txnType === 'credit_adjustment') return 'adjustment';
  if (txnType === 'return_refund') return 'credit';
  return 'adjustment';
}

/**
 * Previous balance for a customer = netAmountDue of the latest non-void
 * invoice before (month, year). A settled prior invoice carries 0 forward,
 * but an overpayment (negative net on a paid invoice) is carried as credit.
 */
export async function getPreviousBalance(
  tenantId: string,
  userId: string,
  month: number,
  year: number,
  dbOrTx: DBOrTx = db,
): Promise<number> {
  const prior = await invoiceRepo.findPreviousNonVoid(tenantId, userId, month, year, dbOrTx);
  if (!prior) return 0;
  const net = Number(prior.netAmountDue ?? 0);
  if (prior.status === 'paid') return Math.max(0, net);
  return net;
}

interface Totals {
  totalCharges: number;
  orderCredits: number;
  totalPayments: number;
  totalAdjustments: number;
  /** Net return_refund credits (refunds reduce the amount due). Not a stored column. */
  totalRefunds: number;
}

// Every active transaction lands in exactly one bucket. Reversal entries
// (same txnType, flipped entryType, created by void/edit/delete) net against
// their originals inside the same bucket.
function computeTotals(
  txns: Array<{ txnType: string; entryType: string; amount: string | number | unknown }>,
): Totals {
  let chargeDebits = 0;
  let chargeCredits = 0;
  let orderCredits = 0;
  let paymentCredits = 0;
  let paymentDebits = 0;
  let debitAdj = 0;
  let creditAdj = 0;
  let refunds = 0;
  for (const t of txns) {
    const amt = Math.abs(Number(t.amount ?? 0));
    const isDebit = t.entryType === 'debit';
    switch (t.txnType) {
      case 'delivery':
      case 'order':
        if (isDebit) {
          chargeDebits += amt;
        } else if (t.txnType === 'order') {
          orderCredits += amt;
        } else {
          chargeCredits += amt;
        }
        break;
      case 'payment':
        if (isDebit) paymentDebits += amt;
        else paymentCredits += amt;
        break;
      case 'debit_adjustment':
        debitAdj += isDebit ? amt : -amt;
        break;
      case 'credit_adjustment':
        creditAdj += isDebit ? -amt : amt;
        break;
      case 'return_refund':
        refunds += isDebit ? -amt : amt;
        break;
      default:
        break;
    }
  }
  return {
    totalCharges: round2(chargeDebits - chargeCredits),
    orderCredits: round2(orderCredits),
    totalPayments: round2(paymentCredits - paymentDebits),
    totalAdjustments: round2(debitAdj - creditAdj),
    totalRefunds: round2(refunds),
  };
}

export function netPayable(parts: {
  previousBalance: number;
  totalCharges: number;
  totalPayments: number;
  orderCredits: number;
  totalAdjustments: number;
  totalRefunds?: number;
}): number {
  return round2(
    parts.previousBalance +
      parts.totalCharges -
      parts.totalPayments -
      parts.orderCredits +
      parts.totalAdjustments -
      (parts.totalRefunds ?? 0),
  );
}

function buildProductSummary(
  items: TransactionItem[],
  totalPayments: number,
): invoiceRepo.InvoiceSummaryInput[] {
  const grouped = new Map<
    string,
    {
      productId: string | null;
      productName: string;
      variantLabel: string;
      unit: string | null;
      totalQuantity: number;
      totalAmount: number;
    }
  >();

  for (const it of items) {
    const name = it.productName ?? 'Product';
    const variant = it.variantLabel ?? '';
    const key = `${it.productId ?? ''}|${name}|${variant}`;
    const acc = grouped.get(key) ?? {
      productId: it.productId ?? null,
      productName: name,
      variantLabel: variant,
      unit: it.unit ?? null,
      totalQuantity: 0,
      totalAmount: 0,
    };
    acc.totalQuantity += Number(it.quantity ?? 0);
    acc.totalAmount += Number(it.amount ?? 0);
    if (!acc.unit && it.unit) acc.unit = it.unit;
    if (!acc.productId && it.productId) acc.productId = it.productId;
    grouped.set(key, acc);
  }

  const deliveryTotal = [...grouped.values()].reduce((s, p) => s + p.totalAmount, 0);

  return [...grouped.values()].map((p) => {
    const avgRate = p.totalQuantity > 0 ? p.totalAmount / p.totalQuantity : 0;
    const share = deliveryTotal > 0 ? p.totalAmount / deliveryTotal : 0;
    const paidAmount = Math.min(p.totalAmount, share * Math.max(0, totalPayments));
    const outstandingAmount = Math.max(0, p.totalAmount - paidAmount);
    return {
      productId: p.productId,
      productName: p.productName,
      variantLabel: p.variantLabel || null,
      unit: p.unit,
      totalQuantity: (Math.round(p.totalQuantity * 1000) / 1000).toFixed(3),
      avgRate: round2(avgRate).toFixed(2),
      totalAmount: round2(p.totalAmount).toFixed(2),
      paidAmount: round2(paidAmount).toFixed(2),
      outstandingAmount: round2(outstandingAmount).toFixed(2),
    };
  });
}

/**
 * Generate (or skip/regenerate) an invoice for a single customer.
 * @returns {{ invoice, action: "created"|"skipped"|"regenerated" }}
 */
export async function generateInvoice(
  tenantId: string,
  userId: string,
  month: number,
  year: number,
  options: GenerateInvoiceOptions = {},
) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('Valid month (1-12) is required', 400);
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new AppError('Valid year is required', 400);
  }
  const {
    force = false,
    isEarlyBilling = false,
    billingCutoffDate,
    generatedBy = 'system',
    notes,
  } = options;
  const generatedByUserId = options.generatedByUserId ?? options.adminId ?? null;
  if (billingCutoffDate && !/^\d{4}-\d{2}-\d{2}$/.test(billingCutoffDate)) {
    throw new AppError('billingCutoffDate must be YYYY-MM-DD', 400);
  }
  if (billingCutoffDate) {
    // Regex alone accepts impossible dates (e.g. 2024-02-30) — verify it is a
    // real calendar date.
    const d = new Date(billingCutoffDate);
    if (Number.isNaN(d.getTime())) throw new AppError('Invalid billingCutoffDate', 400);
  }

  return withTransaction(async (tx) => {
    const mm = String(month).padStart(2, '0');
    const startDate = `${year}-${mm}-01`;
    const monthEnd = lastDayOfMonth(year, month);
    const endDate = billingCutoffDate ?? monthEnd;
    if (billingCutoffDate && (billingCutoffDate < startDate || billingCutoffDate > monthEnd)) {
      throw new AppError('billingCutoffDate must fall within the billing month', 400);
    }

    const existing = await invoiceRepo.findByPeriod(tenantId, userId, month, year, tx);
    if (existing && !force) {
      return { invoice: existing, action: 'skipped' as const };
    }

    const custRows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);
    if (!custRows[0]) throw new AppError(`User ${userId} not found`, 404);

    const txns = await findActiveByPartyAndPeriod(tenantId, 'customer', userId, startDate, endDate, tx);
    const { totalCharges, orderCredits, totalPayments, totalAdjustments, totalRefunds } =
      computeTotals(txns);

    const previousBalance = await getPreviousBalance(tenantId, userId, month, year, tx);
    const netAmountDue = netPayable({
      previousBalance,
      totalCharges,
      totalPayments,
      orderCredits,
      totalAdjustments,
      totalRefunds,
    });

    // Product granularity lives on transaction_items — load items for
    // delivery AND order txns (both contribute charges).
    const chargeIds = txns
      .filter((t) => t.txnType === 'delivery' || t.txnType === 'order')
      .map((t) => t.id);
    let deliveryItems: TransactionItem[] = [];
    if (chargeIds.length > 0) {
      deliveryItems = await tx
        .select()
        .from(transactionItems)
        .where(inArray(transactionItems.transactionId, chargeIds));
    }
    const itemsByTxn = new Map<string, TransactionItem[]>();
    for (const it of deliveryItems) {
      const list = itemsByTxn.get(it.transactionId) ?? [];
      list.push(it);
      itemsByTxn.set(it.transactionId, list);
    }

    const lineItems: invoiceRepo.InvoiceLineItemInput[] = txns
      .map((t) => {
        const items = itemsByTxn.get(t.id) ?? [];
        const single = items.length === 1 ? items[0]! : undefined;
        return {
          entryDate: t.effectiveDate,
          description: t.description,
          category: mapLineCategory(t.txnType),
          referenceId: t.referenceId,
          referenceType: t.referenceType,
          quantity: single?.quantity ?? null,
          unitPrice: single?.rate ?? null,
          amount: Math.abs(Number(t.amount)).toFixed(2),
          productName: single?.productName ?? null,
          variantLabel: single?.variantLabel ?? null,
          unit: single?.unit ?? null,
          entryType: t.entryType as 'debit' | 'credit',
        };
      })
      .sort((a, b) => String(a.entryDate ?? '').localeCompare(String(b.entryDate ?? '')));

    const summary = buildProductSummary(deliveryItems, totalPayments);

    // Only auto-mark paid when money actually covers the bill (or an
    // overpayment exists). A ₹0 invoice with no payments stays draft.
    const status: InvoiceStatus =
      netAmountDue < 0 || (netAmountDue === 0 && totalPayments > 0) ? 'paid' : 'draft';

    let replacedInvoiceId: string | null = null;
    let invoiceNumber: string;
    if (existing && force) {
      await invoiceRepo.updateInvoice(
        tenantId,
        existing.id,
        {
          status: 'void',
          voidReason: 'Regenerated',
          voidedByUserId: generatedByUserId,
        },
        tx,
      );
      replacedInvoiceId = existing.id;
      // Keep the customer-visible number stable across regenerations.
      invoiceNumber = existing.invoiceNumber;
    } else {
      invoiceNumber = await generateInvoiceNumber(tenantId, year, month, tx);
    }

    const invoice = await invoiceRepo.insertInvoice(
      {
        tenantId,
        userId,
        invoiceNumber,
        billingMonth: month,
        billingYear: year,
        previousBalance: previousBalance.toFixed(2),
        totalCharges: totalCharges.toFixed(2),
        orderCredits: orderCredits.toFixed(2),
        totalPayments: totalPayments.toFixed(2),
        totalAdjustments: totalAdjustments.toFixed(2),
        netAmountDue: netAmountDue.toFixed(2),
        status,
        isEarlyBilling,
        billingCutoffDate: billingCutoffDate ?? null,
        voidedByUserId: null,
        replacedInvoiceId,
        paidAt: status === 'paid' ? new Date() : null,
        generatedBy,
        generatedByUserId,
        notes: notes ?? null,
      },
      tx,
    );

    await invoiceRepo.insertLineItems(invoice.id, lineItems, tx);
    await invoiceRepo.insertSummary(invoice.id, summary, tx);

    return {
      invoice,
      action: (existing && force ? 'regenerated' : 'created') as 'created' | 'regenerated',
    };
  });
}

/** Bulk generate invoices for all active customers. Processes in batches of 50. */
export async function generateBulkInvoices(
  tenantId: string,
  month: number,
  year: number,
  options: BulkInvoiceOptions = {},
) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('Valid month (1-12) is required', 400);
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new AppError('Valid year is required', 400);
  }
  const customers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.role, 'customer'),
        eq(users.isActive, true),
        isNull(users.deletedAt),
      ),
    );

  const results = { generated: 0, skipped: 0, errors: [] as Array<{ userId: string; error: string }> };
  const BATCH_SIZE = 50;
  const CONCURRENCY = 5;

  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const batch = customers.slice(i, i + BATCH_SIZE);
    // Bounded concurrency: 5 parallel invoice transactions against a pool of 10.
    for (let j = 0; j < batch.length; j += CONCURRENCY) {
      const group = batch.slice(j, j + CONCURRENCY);
      const settled = await Promise.allSettled(
        group.map((c) => generateInvoice(tenantId, c.id, month, year, options)),
      );
      settled.forEach((s, k) => {
        if (s.status === 'fulfilled') {
          if (s.value.action === 'skipped') results.skipped += 1;
          else results.generated += 1;
        } else {
          results.errors.push({
            userId: group[k]!.id,
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          });
        }
      });
    }
  }

  return results;
}

/**
 * Sync invoice status after a payment is recorded.
 * When `effectiveDate` (the payment's financial date) is provided, the
 * invoice covering that period is synced; otherwise the latest non-void
 * invoice is synced. All components are recomputed live. Never throws.
 */
export async function syncInvoiceStatusAfterPayment(
  tenantId: string,
  userId: string,
  effectiveDate?: string,
): Promise<void> {
  try {
    let invoice = null;
    if (effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      const y = Number(effectiveDate.slice(0, 4));
      const m = Number(effectiveDate.slice(5, 7));
      invoice = await invoiceRepo.findByPeriod(tenantId, userId, m, y, db);
    }
    invoice ??= await invoiceRepo.findLatestNonVoid(tenantId, userId, db);
    if (!invoice) return;

    const mm = String(invoice.billingMonth).padStart(2, '0');
    const startDate = `${invoice.billingYear}-${mm}-01`;
    const endDate = invoice.billingCutoffDate ?? lastDayOfMonth(invoice.billingYear, invoice.billingMonth);

    const txns = await findActiveByPartyAndPeriod(tenantId, 'customer', userId, startDate, endDate, db);
    const { totalCharges, orderCredits, totalPayments, totalAdjustments, totalRefunds } =
      computeTotals(txns);

    const livePreviousBalance = await getPreviousBalance(
      tenantId,
      userId,
      invoice.billingMonth,
      invoice.billingYear,
      db,
    );

    const newNet = netPayable({
      previousBalance: livePreviousBalance,
      totalCharges,
      totalPayments,
      orderCredits,
      totalAdjustments,
      totalRefunds,
    });

    const patch: Partial<typeof invoices.$inferInsert> = {
      previousBalance: livePreviousBalance.toFixed(2),
      totalCharges: totalCharges.toFixed(2),
      orderCredits: orderCredits.toFixed(2),
      totalPayments: totalPayments.toFixed(2),
      totalAdjustments: totalAdjustments.toFixed(2),
      netAmountDue: newNet.toFixed(2),
    };

    if (newNet < 0 || (newNet === 0 && totalPayments > 0)) {
      patch.status = 'paid';
      if (!invoice.paidAt) patch.paidAt = new Date();
    } else if (totalPayments > 0) {
      patch.status = 'partially_paid';
      patch.paidAt = null;
    } else {
      // No payments remain — preserve sent/overdue rather than downgrading to draft.
      if (invoice.status !== 'overdue' && invoice.status !== 'sent') patch.status = 'draft';
      patch.paidAt = null;
    }

    await invoiceRepo.updateInvoice(tenantId, invoice.id, patch, db);
  } catch (err) {
    logger.error({ err, tenantId, userId }, '[InvoiceSync] Failed to sync invoice status after payment');
  }
}

/**
 * Mark sent/partially-paid invoices from prior months as overdue.
 * Draft invoices (never sent to the customer) are left alone.
 * @returns {{ marked: number }}
 */
export async function markOverdueInvoices(tenantId: string): Promise<{ marked: number }> {
  const todayStr = toDateOnlyString(istToday());
  const currentYear = Number(todayStr.slice(0, 4));
  const currentMonth = Number(todayStr.slice(5, 7));
  const updated = await db
    .update(invoices)
    .set({ status: 'overdue', updatedAt: new Date() })
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        inArray(invoices.status, ['sent', 'partially_paid'] as InvoiceStatus[]),
        sql`${invoices.netAmountDue} > 0`,
        orFallback(currentYear, currentMonth),
      ),
    )
    .returning({ id: invoices.id });
  return { marked: updated.length };
}

function orFallback(currentYear: number, currentMonth: number) {
  return sql`(${invoices.billingYear} < ${currentYear} OR (${invoices.billingYear} = ${currentYear} AND ${invoices.billingMonth} < ${currentMonth}))`;
}

/** Full invoice detail (header + lines + product summary + customer) for admin reads. */
export async function getInvoiceDetail(tenantId: string, invoiceId: string, dbOrTx: DBOrTx = db) {
  const invoice = await invoiceRepo.findById(tenantId, invoiceId, dbOrTx);
  if (!invoice) throw new AppError('Invoice not found', 404);
  const [lineItems, summary, customerRows] = await Promise.all([
    invoiceRepo.findLineItems(invoiceId, dbOrTx),
    invoiceRepo.findSummary(invoiceId, dbOrTx),
    (dbOrTx as typeof db)
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        email: users.email,
        accountBalance: users.accountBalance,
      })
      .from(users)
      .where(and(eq(users.id, invoice.userId), eq(users.tenantId, tenantId)))
      .limit(1),
  ]);
  return { invoice, lineItems, productSummary: summary, customer: customerRows[0] ?? null };
}

/** Customer-scoped invoice detail (excludes voided/cancelled) + brand payment config. */
export async function getMyInvoiceDetail(
  tenantId: string,
  userId: string,
  invoiceId: string,
  dbOrTx: DBOrTx = db,
) {
  const invoice = await invoiceRepo.findByIdForUser(tenantId, userId, invoiceId, true, dbOrTx);
  if (!invoice) throw new AppError('Invoice not found', 404);
  const [lineItems, summary, tenantRows] = await Promise.all([
    invoiceRepo.findLineItems(invoiceId, dbOrTx),
    invoiceRepo.findSummary(invoiceId, dbOrTx),
    (dbOrTx as typeof db).select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
  ]);
  const tenant = tenantRows[0];
  const brandConfig = {
    phone: tenant?.brandPhone ?? process.env.BRAND_PHONE ?? '9244237975',
    upiId: tenant?.upiId ?? process.env.UPI_ID ?? '',
    upiName: tenant?.upiName ?? process.env.UPI_NAME ?? 'Farmilky',
  };
  return { invoice, lineItems, productSummary: summary, brandConfig };
}

export const invoiceService = {
  generateInvoice,
  generateBulkInvoices,
  syncInvoiceStatusAfterPayment,
  markOverdueInvoices,
};
