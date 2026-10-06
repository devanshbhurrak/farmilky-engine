import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { istToday, round2, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { buildMeta, parsePagination } from '../../shared/utils/pagination.js';
import { transactionService } from '../transactions/transaction.service.js';
import { findSupplierById, listActiveSuppliers } from '../suppliers/supplier.repository.js';
import {
  findActiveTxnForCollection,
  findBySupplierDateSession,
  findCollectionById,
  insertManyCollections,
  listCollectionsByDate,
  listCollectionsInRange,
  listCollectionHistory,
  listConfirmedUnsettled,
  listPendingByDate,
  updateCollectionRow,
} from './milkCollection.repository.js';
import type {
  BulkConfirmInput,
  ConfirmInput,
  HistoryQuery,
  MissingQuery,
  UpdateCollectionInput,
} from './milkCollection.schema.js';

function toNum(v: string | number | null | undefined, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function doConfirm(
  t: DrizzleTx,
  tenantId: string,
  collection: NonNullable<Awaited<ReturnType<typeof findCollectionById>>>,
  params: { actualQty: number; ratePerLiter: number; fatContent?: number | null; snf?: number | null; notes?: string },
  adminId: string,
) {
  const existingTxn = await findActiveTxnForCollection(tenantId, collection.id, t);
  if (collection.status === 'confirmed' && existingTxn) {
    await transactionService.voidTransaction(
      existingTxn.id,
      tenantId,
      `Correction for collection ${collection.id}`,
      adminId,
      t,
    );
  }
  const amount = round2(params.actualQty * params.ratePerLiter);
  if (!(amount > 0)) throw new AppError('Collection amount must be greater than zero', 400);
  const supplier = await findSupplierById(tenantId, collection.supplierId, t);
  if (!supplier) throw new AppError('Supplier not found', 404);
  const txn = await transactionService.createTransaction(
    {
      tenantId,
      partyType: 'supplier',
      partyId: collection.supplierId,
      txnType: 'milk_collection',
      entryType: 'credit',
      amount,
      effectiveDate: collection.collectionDate,
      referenceType: 'milk_collection',
      referenceId: collection.id,
      description: `Milk collection ${collection.collectionDate} (${collection.session})`,
      notes: params.notes ?? null,
      createdById: adminId,
    },
    t,
  );
  const updated = await updateCollectionRow(
    collection.id,
    {
      status: 'confirmed',
      actualQty: String(params.actualQty),
      ratePerLiter: String(params.ratePerLiter),
      fatContent: params.fatContent !== undefined && params.fatContent !== null ? String(params.fatContent) : null,
      snf: params.snf !== undefined && params.snf !== null ? String(params.snf) : null,
      notes: params.notes ?? collection.notes ?? null,
      confirmedById: adminId,
      confirmedAt: new Date(),
    },
    t,
  );
  return { collection: updated, txn };
}

export async function confirmCollection(
  tenantId: string,
  collectionId: string,
  params: ConfirmInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const collection = await findCollectionById(collectionId, tenantId, t);
    if (!collection) throw new AppError('Collection not found', 404);
    return doConfirm(
      t,
      tenantId,
      collection,
      {
        actualQty: params.actualQty,
        ratePerLiter: params.ratePerLiter,
        fatContent: params.fatContent ?? null,
        snf: params.snf ?? null,
        notes: params.notes,
      },
      adminId,
    );
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function generateCollections(tenantId: string, date: string, _adminId?: string, tx?: DrizzleTx) {
  const run = async (t: DrizzleTx) => {
    const activeSuppliers = await listActiveSuppliers(tenantId, t);
    let created = 0;
    let skipped = 0;
    const toInsert: Array<{ supplierId: string; collectionDate: string; session: 'morning' | 'evening'; expectedQty: string; ratePerLiter: string }> = [];
    for (const s of activeSuppliers) {
      const rate = String(s.defaultRatePerLiter ?? '0');
      if (s.morningSession) {
        const exists = await findBySupplierDateSession(tenantId, s.id, date, 'morning', t);
        if (exists) {
          skipped += 1;
        } else {
          toInsert.push({
            supplierId: s.id,
            collectionDate: date,
            session: 'morning',
            expectedQty: String(s.defaultMorningQty ?? '0'),
            ratePerLiter: rate,
          });
        }
      }
      if (s.eveningSession) {
        const exists = await findBySupplierDateSession(tenantId, s.id, date, 'evening', t);
        if (exists) {
          skipped += 1;
        } else {
          toInsert.push({
            supplierId: s.id,
            collectionDate: date,
            session: 'evening',
            expectedQty: String(s.expectedEveningQty ?? '0'),
            ratePerLiter: rate,
          });
        }
      }
    }
    if (toInsert.length > 0) {
      await insertManyCollections(tenantId, toInsert, t);
      created = toInsert.length;
    }
    return { created, skipped, date };
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function getDailyCollections(tenantId: string, date: string, dbOrTx: DBOrTx = db) {
  await generateCollections(tenantId, date);
  const rows = await listCollectionsByDate(tenantId, date, dbOrTx);
  const confirmed = rows.filter((r) => r.status === 'confirmed');
  return {
    collections: rows,
    summary: {
      total: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      confirmed: confirmed.length,
      totalLiters: round2(confirmed.reduce((s, r) => s + toNum(r.actualQty), 0)),
      totalAmount: round2(confirmed.reduce((s, r) => s + toNum(r.actualQty) * toNum(r.ratePerLiter), 0)),
    },
    date,
  };
}

export async function bulkConfirmCollections(tenantId: string, input: BulkConfirmInput, adminId: string, tx?: DrizzleTx) {
  const run = async (t: DrizzleTx) => {
    const pending = await listPendingByDate(tenantId, input.date, input.session, t);
    let confirmed = 0;
    for (const c of pending) {
      const supplier = await findSupplierById(tenantId, c.supplierId, t);
      const actualQty = toNum(c.expectedQty);
      const rate = input.ratePerLiter ?? toNum(supplier?.defaultRatePerLiter, 0);
      if (!(actualQty > 0) || !(rate > 0)) continue;
      await doConfirm(t, tenantId, c, { actualQty, ratePerLiter: rate }, adminId);
      confirmed += 1;
    }
    return { confirmed, date: input.date };
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function getCollectionHistory(tenantId: string, query: HistoryQuery, dbOrTx: DBOrTx = db) {
  const { page, limit, offset } = parsePagination(query);
  const { rows, total, aggregates } = await listCollectionHistory(
    tenantId,
    { supplierId: query.supplierId, startDate: query.startDate, endDate: query.endDate, status: query.status },
    { limit, offset },
    dbOrTx,
  );
  return { rows, meta: buildMeta(total, page, limit), aggregates };
}

export async function updateCollection(
  tenantId: string,
  collectionId: string,
  input: UpdateCollectionInput,
  adminId: string,
  tx?: DrizzleTx,
) {
  const run = async (t: DrizzleTx) => {
    const collection = await findCollectionById(collectionId, tenantId, t);
    if (!collection) throw new AppError('Collection not found', 404);
    if (collection.status === 'pending') {
      const patch: Parameters<typeof updateCollectionRow>[1] = {};
      if (input.actualQty !== undefined) patch.actualQty = String(input.actualQty);
      if (input.ratePerLiter !== undefined) patch.ratePerLiter = String(input.ratePerLiter);
      if (input.fatContent !== undefined) patch.fatContent = input.fatContent === null ? null : String(input.fatContent);
      if (input.snf !== undefined) patch.snf = input.snf === null ? null : String(input.snf);
      if (input.notes !== undefined) patch.notes = input.notes;
      const updated = await updateCollectionRow(collection.id, patch, t);
      return { collection: updated, txn: null };
    }
    const newQty = input.actualQty ?? toNum(collection.actualQty);
    const newRate = input.ratePerLiter ?? toNum(collection.ratePerLiter);
    const existingTxn = await findActiveTxnForCollection(tenantId, collection.id, t);
    if (existingTxn) {
      await transactionService.voidTransaction(existingTxn.id, tenantId, input.void_reason, adminId, t);
    }
    const amount = round2(newQty * newRate);
    if (!(amount > 0)) throw new AppError('Collection amount must be greater than zero', 400);
    const txn = await transactionService.createTransaction(
      {
        tenantId,
        partyType: 'supplier',
        partyId: collection.supplierId,
        txnType: 'milk_collection',
        entryType: 'credit',
        amount,
        effectiveDate: collection.collectionDate,
        referenceType: 'milk_collection',
        referenceId: collection.id,
        description: `Milk collection correction ${collection.collectionDate} (${collection.session})`,
        notes: input.notes ?? null,
        createdById: adminId,
      },
      t,
    );
    const updated = await updateCollectionRow(
      collection.id,
      {
        status: 'confirmed',
        actualQty: String(newQty),
        ratePerLiter: String(newRate),
        fatContent:
          input.fatContent !== undefined
            ? input.fatContent === null
              ? null
              : String(input.fatContent)
            : collection.fatContent,
        snf: input.snf !== undefined ? (input.snf === null ? null : String(input.snf)) : collection.snf,
        notes: input.notes ?? collection.notes ?? null,
        confirmedById: adminId,
        confirmedAt: new Date(),
      },
      t,
    );
    return { collection: updated, txn };
  };
  if (tx) return run(tx);
  return withTransaction(run);
}

export async function getTodayShift(tenantId: string, dbOrTx: DBOrTx = db) {
  const today = toDateOnlyString(istToday());
  const rows = await listCollectionsByDate(tenantId, today, dbOrTx);
  const result = {
    morning: { confirmed: 0, total: 0, qty: 0, amount: 0 },
    evening: { confirmed: 0, total: 0, qty: 0, amount: 0 },
  };
  for (const c of rows) {
    const slot = c.session === 'evening' ? result.evening : result.morning;
    slot.total += 1;
    if (c.status === 'confirmed') {
      slot.confirmed += 1;
      slot.qty = round2(slot.qty + toNum(c.actualQty));
      slot.amount = round2(slot.amount + toNum(c.actualQty) * toNum(c.ratePerLiter));
    }
  }
  return { ...result, date: today };
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cur <= last) {
    out.push(toDateOnlyString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export async function getMissingCollections(tenantId: string, query: MissingQuery, dbOrTx: DBOrTx = db) {
  const { startDate, endDate } = query;
  if (startDate > endDate) throw new AppError('startDate must be <= endDate', 400);
  const activeSuppliers = await listActiveSuppliers(tenantId, dbOrTx);
  const dates = eachDate(startDate, endDate);
  const existing = await listCollectionsInRange(tenantId, startDate, endDate, dbOrTx);
  const existingSet = new Set(existing.map((c) => `${c.supplierId}|${c.collectionDate}|${c.session}`));
  const missing: Array<{ date: string; session: 'morning' | 'evening'; supplierId: string; supplierName: string }> = [];
  for (const date of dates) {
    for (const s of activeSuppliers) {
      if (s.morningSession) {
        const key = `${s.id}|${date}|morning`;
        if (!existingSet.has(key)) {
          missing.push({ date, session: 'morning', supplierId: s.id, supplierName: s.name });
        }
      }
      if (s.eveningSession) {
        const key = `${s.id}|${date}|evening`;
        if (!existingSet.has(key)) {
          missing.push({ date, session: 'evening', supplierId: s.id, supplierName: s.name });
        }
      }
    }
  }
  return { missing, total: missing.length };
}

export async function getUnsettledForSupplier(tenantId: string, supplierId?: string, dbOrTx: DBOrTx = db) {
  return listConfirmedUnsettled(tenantId, supplierId, dbOrTx);
}
