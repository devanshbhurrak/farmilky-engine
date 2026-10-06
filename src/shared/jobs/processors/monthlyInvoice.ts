import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants } from '../../db/schema/index.js';
import { istToday, toDateOnlyString } from '../../utils/dateUtils.js';
import { logger } from '../../utils/logger.js';
import {
  generateBulkInvoices,
  markOverdueInvoices,
} from '../../../modules/invoices/invoice.service.js';

async function listActiveTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.isActive, true));
  return rows.map((r) => r.id);
}

async function processMonthlyTenant(tenantId: string): Promise<void> {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`);
  try {
    // istToday() is already an IST-midnight date; derive prior month in IST.
    const todayStr = toDateOnlyString(istToday());
    const thisYear = Number(todayStr.slice(0, 4));
    const thisMonth = Number(todayStr.slice(5, 7));
    let month = thisMonth - 1;
    let year = thisYear;
    if (month === 0) {
      month = 12;
      year -= 1;
    }

    // Fail loudly (job retry + alerting) instead of warn-and-skip billing.
    await markOverdueInvoices(tenantId).catch((err) => {
      logger.error({ err, tenantId }, 'monthly-invoice: markOverdueInvoices failed');
      throw err;
    });
    const result = await generateBulkInvoices(tenantId, month, year, { generatedBy: 'system' }).catch(
      (err) => {
        logger.error({ err, tenantId }, 'monthly-invoice: generateBulkInvoices failed');
        throw err;
      },
    );
    logger.info({ tenantId, month, year, result }, 'monthly-invoice: completed');
  } finally {
    await db.execute(sql`SELECT set_config('app.tenant_id', '', false)`).catch(() => undefined);
  }
}

export async function monthlyInvoiceProcessor(payload: { tenantId?: string }): Promise<void> {
  const tenantId = payload?.tenantId;
  if (!tenantId) {
    const ids = await listActiveTenantIds();
    for (const id of ids) {
      try {
        await processMonthlyTenant(id);
      } catch (err) {
        logger.error({ err, tenantId: id }, 'monthly-invoice: tenant failed');
      }
    }
    return;
  }
  await processMonthlyTenant(tenantId);
}
