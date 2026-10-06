import { sql } from 'drizzle-orm';
import { invoiceCounters } from '../db/schema/index.js';
import type { DrizzleTx } from '../types/index.js';

export async function generateInvoiceNumber(
  tenantId: string,
  year: number,
  month: number,
  tx: DrizzleTx,
): Promise<string> {
  const mm = String(month).padStart(2, '0');
  const counterId = `${tenantId}:${year}-${mm}`;

  const rows = (await tx
    .insert(invoiceCounters)
    .values({ id: counterId, seq: 1 })
    .onConflictDoUpdate({
      target: invoiceCounters.id,
      set: { seq: sql`${invoiceCounters.seq} + 1` },
    })
    .returning({ seq: invoiceCounters.seq })) as Array<{ seq: number }>;

  const seq = rows[0]?.seq ?? 1;
  return `INV-${year}-${mm}-${String(seq).padStart(4, '0')}`;
}
