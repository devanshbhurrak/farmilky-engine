import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { istToday, round2, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { listConfirmedUnsettled } from '../milk-collections/milkCollection.repository.js';
import { findSupplierById } from '../suppliers/supplier.repository.js';
import { transactionService } from '../transactions/transaction.service.js';
import {
  insertSettlement,
  listSupplierHistoryTxns,
  summarizeCollectionTotal,
} from './supplierPayment.repository.js';
import type {
  CollectionTotalQuery,
  ListSupplierPaymentsQuery,
  OutstandingQuery,
  RecordSupplierPaymentInput,
  SupplierHistoryQuery,
} from './supplierPayment.schema.js';

export async function recordSupplierPayment(
  tenantId: string,
  input: RecordSupplierPaymentInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const supplier = await findSupplierById(tenantId, input.supplierId, t);
    if (!supplier) throw new AppError('Supplier not found', 404);

    const allOutstanding = await listConfirmedUnsettled(tenantId, input.supplierId, t);
    let items = allOutstanding;
    if (input.settleCollectionIds && input.settleCollectionIds.length > 0) {
      const wanted = new Set(input.settleCollectionIds);
      items = allOutstanding.filter((o) => wanted.has(o.collectionId));
      if (items.length !== wanted.size) {
        throw new AppError('One or more collections are invalid, not confirmed, or already settled', 400);
      }
      for (const item of items) {
        if (item.supplierId !== input.supplierId) {
          throw new AppError('Collection does not belong to supplier', 400);
        }
      }
    }

    const settledTotal = round2(items.reduce((s, i) => s + Number(i.txnAmount), 0));
    const effectiveDate = input.date ?? toDateOnlyString(istToday());

    const paymentTxn = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'supplier',
        partyId: input.supplierId,
        txnType: 'supplier_payment',
        entryType: 'debit',
        amount: input.amount,
        effectiveDate,
        paymentMethod: input.paymentMethod ?? 'cash',
        paymentRef: input.paymentRef ?? null,
        description: input.description ?? 'Supplier payment',
        notes: input.notes ?? null,
        createdById: adminId,
      },
      t,
    );

    for (const item of items) {
      await insertSettlement(tenantId, paymentTxn.id, item.txnId, item.txnAmount, t);
    }

    let differenceAdjustment: unknown = null;
    const diff = round2(input.amount - settledTotal);
    if (Math.abs(diff) > 0.01) {
      differenceAdjustment = await transactionService.createTransaction(
        {
          tenantId,
          partyType: 'supplier',
          partyId: input.supplierId,
          txnType: 'supplier_adjustment',
          txnCategory: 'payment_difference',
          entryType: diff > 0 ? 'debit' : 'credit',
          amount: Math.abs(diff),
          effectiveDate,
          description: 'Auto payment difference adjustment',
          notes: `Paid ${input.amount} against ${settledTotal} settled`,
          createdById: adminId,
        },
        t,
      );
    }

    return {
      payment: paymentTxn,
      settledCount: items.length,
      settledTotal,
      adjustment: differenceAdjustment,
    };
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function getOutstanding(tenantId: string, query: OutstandingQuery, dbOrTx: DBOrTx = db) {
  if (query.supplierId) {
    const supplier = await findSupplierById(tenantId, query.supplierId, dbOrTx);
    if (!supplier) throw new AppError('Supplier not found', 404);
    const items = await listConfirmedUnsettled(tenantId, query.supplierId, dbOrTx);
    const outstandingAmount = round2(items.reduce((s, i) => s + Number(i.txnAmount), 0));
    return {
      outstanding: [
        {
          supplierId: query.supplierId,
          supplierName: supplier.name,
          supplierPhone: supplier.phone,
          outstandingAmount,
          collectionCount: items.length,
          earliestDate: items.length > 0 ? items[0]!.collectionDate : null,
        },
      ],
    };
  }
  const items = await listConfirmedUnsettled(tenantId, undefined, dbOrTx);
  const bySupplier = new Map<string, { amount: number; count: number; earliest: string | null }>();
  for (const item of items) {
    const cur = bySupplier.get(item.supplierId) ?? { amount: 0, count: 0, earliest: null };
    cur.amount = round2(cur.amount + Number(item.txnAmount));
    cur.count += 1;
    if (!cur.earliest || item.collectionDate < cur.earliest) cur.earliest = item.collectionDate;
    bySupplier.set(item.supplierId, cur);
  }
  const outstanding: Array<{
    supplierId: string;
    supplierName: string;
    supplierPhone: string;
    outstandingAmount: number;
    collectionCount: number;
    earliestDate: string | null;
  }> = [];
  for (const [supplierId, agg] of bySupplier) {
    const supplier = await findSupplierById(tenantId, supplierId, dbOrTx);
    if (!supplier) continue;
    outstanding.push({
      supplierId,
      supplierName: supplier.name,
      supplierPhone: supplier.phone,
      outstandingAmount: agg.amount,
      collectionCount: agg.count,
      earliestDate: agg.earliest,
    });
  }
  outstanding.sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  return { outstanding };
}

export async function getCollectionTotal(tenantId: string, query: CollectionTotalQuery, dbOrTx: DBOrTx = db) {
  const summary = await summarizeCollectionTotal(
    tenantId,
    { supplierId: query.supplierId, startDate: query.startDate, endDate: query.endDate },
    dbOrTx,
  );
  const collectionTotal = round2(summary.collectionTotal);
  const adjustmentNet = round2(summary.adjustmentNet);
  return {
    collectionTotal,
    collectionCount: summary.collectionCount,
    adjustmentNet,
    grandTotal: round2(collectionTotal + adjustmentNet),
    adjustmentCount: summary.adjustmentCount,
  };
}

export async function getSupplierPaymentHistory(
  tenantId: string,
  supplierId: string,
  query: SupplierHistoryQuery,
  dbOrTx: DBOrTx = db,
) {
  const supplier = await findSupplierById(tenantId, supplierId, dbOrTx);
  if (!supplier) throw new AppError('Supplier not found', 404);
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listSupplierHistoryTxns(tenantId, supplierId, { limit, offset }, dbOrTx);
  return { rows, meta: buildMeta(total, page, limit), supplier };
}

export async function listSupplierPayments(
  tenantId: string,
  query: ListSupplierPaymentsQuery,
  dbOrTx: DBOrTx = db,
) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total } = await listSupplierHistoryTxns(tenantId, query.supplierId, { limit, offset }, dbOrTx);
  return { rows, meta: buildMeta(total, page, limit) };
}
