import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { getCache } from '../../shared/cache/index.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { normalizeDate, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import type { CreateHolidayInput, UpdateHolidayInput } from './holiday.schema.js';
import {
  createHolidayRow,
  deleteHolidayRow,
  findHolidayByDate,
  findHolidayById,
  listActiveHolidays,
  listHolidays,
  updateHolidayRow,
} from './holiday.repository.js';

const HOLIDAY_CACHE_TTL_SECONDS = 600;

function holidayCacheKey(tenantId: string): string {
  return `holidays:${tenantId}`;
}

export function toHolidayDateOnly(input: string): string {
  const [y, m, d] = input.split('-').map(Number);
  const normalized = normalizeDate(new Date(y!, m! - 1, d!));
  return toDateOnlyString(normalized);
}

async function invalidateHolidayCache(tenantId: string): Promise<void> {
  await getCache().del(holidayCacheKey(tenantId));
}

export async function listHolidaysService(
  tenantId: string,
  opts: { year?: number },
  dbOrTx: DBOrTx = db,
) {
  return listHolidays(tenantId, opts, dbOrTx);
}

export async function createHolidayService(
  tenantId: string,
  input: CreateHolidayInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const holidayDate = toHolidayDateOnly(input.date);
    const existing = await findHolidayByDate(tenantId, holidayDate, t);
    if (existing) throw new AppError('Holiday already exists for this date', 409);
    const holiday = await createHolidayRow(
      tenantId,
      { holidayDate, name: input.name, isActive: input.isActive },
      t,
    );
    await invalidateHolidayCache(tenantId);
    return holiday;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function updateHolidayService(
  tenantId: string,
  holidayId: string,
  input: UpdateHolidayInput,
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    const existing = await findHolidayById(tenantId, holidayId, t);
    if (!existing) throw new AppError('Holiday not found', 404);
    const updated = await updateHolidayRow(tenantId, holidayId, input, t);
    if (!updated) throw new AppError('Holiday not found', 404);
    await invalidateHolidayCache(tenantId);
    return updated;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function deleteHolidayService(tenantId: string, holidayId: string, tx?: DrizzleTx) {
  const run = async (t: DBOrTx) => {
    const row = await deleteHolidayRow(tenantId, holidayId, t);
    if (!row) throw new AppError('Holiday not found', 404);
    await invalidateHolidayCache(tenantId);
    return { deleted: true };
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function getHolidayDateSet(tenantId: string, dbOrTx: DBOrTx = db): Promise<Set<number>> {
  const cache = getCache();
  const key = holidayCacheKey(tenantId);
  const cached = await cache.get<number[]>(key);
  if (cached) return new Set(cached);

  const rows = await listActiveHolidays(tenantId, dbOrTx);
  const timestamps = rows.map((h) => normalizeDate(h.holidayDate).getTime());
  await cache.set(key, timestamps, HOLIDAY_CACHE_TTL_SECONDS);
  return new Set(timestamps);
}
