import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import { milkCollections, suppliers, transactionSettlements, transactions } from '../../shared/db/schema/index.js';
import type { DBOrTx } from '../../shared/types/index.js';

export interface InsertSupplierData {
  name: string;
  phone: string;
  email?: string | null;
  location?: string | null;
  pincode?: string | null;
  joiningDate?: string | null;
  morningSession?: boolean;
  eveningSession?: boolean;
  defaultMorningQty?: number;
  expectedEveningQty?: number;
  defaultRatePerLiter?: number;
  bankAccountNo?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  bankHolderName?: string | null;
  notes?: string | null;
  linkedUserId?: string | null;
}

export async function findSupplierById(tenantId: string, supplierId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findSupplierByPhone(tenantId: string, phone: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.phone, phone), isNull(suppliers.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSuppliers(
  tenantId: string,
  pagination: { limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const conds = [eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)];
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(suppliers)
    .where(and(...conds))
    .orderBy(desc(suppliers.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset);
  const [{ count }] = await (dbOrTx as typeof db)
    .select({ count: sql<number>`count(*)::int` })
    .from(suppliers)
    .where(and(...conds));
  return { rows, total: count };
}

export async function listActiveSuppliers(tenantId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.isActive, true), isNull(suppliers.deletedAt)))
    .orderBy(suppliers.name);
}

export async function insertSupplier(tenantId: string, data: InsertSupplierData, dbOrTx: DBOrTx = db) {
  const [created] = await (dbOrTx as typeof db)
    .insert(suppliers)
    .values({
      tenantId,
      name: data.name,
      phone: data.phone,
      email: data.email ?? null,
      location: data.location ?? null,
      pincode: data.pincode ?? null,
      joiningDate: data.joiningDate ?? null,
      morningSession: data.morningSession ?? true,
      eveningSession: data.eveningSession ?? false,
      defaultMorningQty: String(data.defaultMorningQty ?? 0),
      expectedEveningQty: String(data.expectedEveningQty ?? 0),
      defaultRatePerLiter: String(data.defaultRatePerLiter ?? 0),
      bankAccountNo: data.bankAccountNo ?? null,
      bankIfsc: data.bankIfsc ?? null,
      bankName: data.bankName ?? null,
      bankHolderName: data.bankHolderName ?? null,
      notes: data.notes ?? null,
      linkedUserId: data.linkedUserId ?? null,
    })
    .returning();
  return created!;
}

export async function updateSupplierRow(
  tenantId: string,
  supplierId: string,
  patch: Partial<InsertSupplierData> & { isActive?: boolean },
  dbOrTx: DBOrTx = db,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.phone !== undefined) set.phone = patch.phone;
  if (patch.email !== undefined) set.email = patch.email ?? null;
  if (patch.location !== undefined) set.location = patch.location ?? null;
  if (patch.pincode !== undefined) set.pincode = patch.pincode ?? null;
  if (patch.joiningDate !== undefined) set.joiningDate = patch.joiningDate ?? null;
  if (patch.morningSession !== undefined) set.morningSession = patch.morningSession;
  if (patch.eveningSession !== undefined) set.eveningSession = patch.eveningSession;
  if (patch.defaultMorningQty !== undefined) set.defaultMorningQty = String(patch.defaultMorningQty);
  if (patch.expectedEveningQty !== undefined) set.expectedEveningQty = String(patch.expectedEveningQty);
  if (patch.defaultRatePerLiter !== undefined) set.defaultRatePerLiter = String(patch.defaultRatePerLiter);
  if (patch.bankAccountNo !== undefined) set.bankAccountNo = patch.bankAccountNo ?? null;
  if (patch.bankIfsc !== undefined) set.bankIfsc = patch.bankIfsc ?? null;
  if (patch.bankName !== undefined) set.bankName = patch.bankName ?? null;
  if (patch.bankHolderName !== undefined) set.bankHolderName = patch.bankHolderName ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.linkedUserId !== undefined) set.linkedUserId = patch.linkedUserId ?? null;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  const [updated] = await (dbOrTx as typeof db)
    .update(suppliers)
    .set(set)
    .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function softDeleteSupplierRow(tenantId: string, supplierId: string, dbOrTx: DBOrTx = db) {
  const [updated] = await (dbOrTx as typeof db)
    .update(suppliers)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)))
    .returning();
  return updated ?? null;
}

/** Count confirmed-but-unsettled collections for a supplier. */
export async function countConfirmedUnsettled(tenantId: string, supplierId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ count: sql<number>`count(*)::int` })
    .from(milkCollections)
    .leftJoin(
      transactions,
      and(
        eq(transactions.referenceType, 'milk_collection'),
        eq(transactions.referenceId, milkCollections.id),
        eq(transactions.tenantId, tenantId),
        eq(transactions.status, 'active'),
      ),
    )
    .leftJoin(transactionSettlements, eq(transactionSettlements.settledTxnId, transactions.id))
    .where(
      and(
        eq(milkCollections.tenantId, tenantId),
        eq(milkCollections.supplierId, supplierId),
        eq(milkCollections.status, 'confirmed'),
        sql`${transactionSettlements.id} IS NULL`,
      ),
    );
  return rows[0]?.count ?? 0;
}

export async function hasSettlementForTxn(settledTxnId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ id: transactionSettlements.id })
    .from(transactionSettlements)
    .where(eq(transactionSettlements.settledTxnId, settledTxnId))
    .limit(1);
  return rows.length > 0;
}
