import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { holidays } from '../../shared/db/schema/index.js';

export async function listHolidays(
  tenantId: string,
  opts: { year?: number },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(holidays.tenantId, tenantId)];
  if (opts.year !== undefined) {
    conditions.push(gte(holidays.holidayDate, `${opts.year}-01-01`));
    conditions.push(lte(holidays.holidayDate, `${opts.year}-12-31`));
  }
  return (dbOrTx as typeof db)
    .select()
    .from(holidays)
    .where(and(...conditions))
    .orderBy(holidays.holidayDate);
}

export async function findHolidayById(tenantId: string, holidayId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(holidays)
    .where(and(eq(holidays.tenantId, tenantId), eq(holidays.id, holidayId)))
    .limit(1);
  return rows[0];
}

export async function findHolidayByDate(tenantId: string, date: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(holidays)
    .where(and(eq(holidays.tenantId, tenantId), eq(holidays.holidayDate, date)))
    .limit(1);
  return rows[0];
}

export async function createHolidayRow(
  tenantId: string,
  data: { holidayDate: string; name: string; isActive?: boolean },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(holidays)
    .values({
      tenantId,
      holidayDate: data.holidayDate,
      name: data.name,
      isActive: data.isActive ?? true,
    })
    .returning();
  return rows[0]!;
}

export async function updateHolidayRow(
  tenantId: string,
  holidayId: string,
  data: { name?: string; isActive?: boolean },
  dbOrTx: DBOrTx = db,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  const rows = await (dbOrTx as typeof db)
    .update(holidays)
    .set(patch)
    .where(and(eq(holidays.tenantId, tenantId), eq(holidays.id, holidayId)))
    .returning();
  return rows[0];
}

export async function deleteHolidayRow(tenantId: string, holidayId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .delete(holidays)
    .where(and(eq(holidays.tenantId, tenantId), eq(holidays.id, holidayId)))
    .returning({ id: holidays.id });
  return rows[0];
}

export async function listActiveHolidays(tenantId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(holidays)
    .where(and(eq(holidays.tenantId, tenantId), eq(holidays.isActive, true)))
    .orderBy(holidays.holidayDate);
}
