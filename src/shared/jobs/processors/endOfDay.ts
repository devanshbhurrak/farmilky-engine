import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants } from '../../db/schema/index.js';
import { withTransaction } from '../../db/transaction.js';
import { istToday, toDateOnlyString } from '../../utils/dateUtils.js';
import { logger } from '../../utils/logger.js';
import {
  findIncomplete,
  listPendingEntries,
  updateEntry,
  updateManifestStatus,
} from '../../../modules/manifests/manifest.repository.js';
import { recordDeliveryOutcome as recordSubscriptionOutcome } from '../../../modules/subscriptions/subscription.service.js';
import { recordDeliveryOutcome as recordOrderOutcome } from '../../../modules/orders/order.service.js';

async function listActiveTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.isActive, true));
  return rows.map((r) => r.id);
}

async function processEndOfDayTenant(tenantId: string): Promise<void> {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`);
  try {
    const todayStr = toDateOnlyString(istToday());
    const incomplete = await findIncomplete(tenantId, todayStr);
    for (const row of incomplete) {
      try {
        await withTransaction(async (tx) => {
          // Route every pending entry through the domain layer so the
          // subscription ledger, order attempts and nextDeliveryDate stay
          // consistent with what the manifest shows. Failed outcomes never
          // create financial transactions.
          const pending = await listPendingEntries(row.manifest.id, tenantId, tx);
          for (const entry of pending) {
            try {
              if (entry.entryType === 'subscription' && entry.subscriptionId) {
                await recordSubscriptionOutcome(
                  entry.subscriptionId,
                  tenantId,
                  {
                    deliveryDate: row.manifest.manifestDate,
                    slot: row.manifest.deliverySlot,
                    status: 'failed',
                    reason: 'not attempted',
                  },
                  'system',
                  tx,
                );
              } else if (entry.entryType === 'order' && entry.orderId) {
                await recordOrderOutcome(
                  tenantId,
                  entry.orderId,
                  {
                    status: 'failed',
                    reason: 'not attempted',
                    attemptDate: row.manifest.manifestDate,
                    effectiveDate: row.manifest.manifestDate,
                  },
                  'system',
                  tx,
                );
              }
            } catch (entryErr) {
              // One bad entry must not block the rest of the sheet.
              logger.error(
                { err: entryErr, tenantId, entryId: entry.id },
                'end-of-day: entry outcome failed',
              );
            }
          }
          // Belt-and-braces: anything still pending (e.g. failed above) is
          // marked failed so the sheet always closes.
          const stillPending = await listPendingEntries(row.manifest.id, tenantId, tx);
          for (const entry of stillPending) {
            await updateEntry(entry.id, tenantId, { status: 'failed', failureReason: 'not attempted' }, tx);
          }
          await updateManifestStatus(tenantId, row.manifest.id, 'completed', tx);
        });
      } catch (err) {
        logger.error({ err, tenantId, manifestId: row.manifest.id }, 'end-of-day: manifest failed');
      }
    }
  } finally {
    await db.execute(sql`SELECT set_config('app.tenant_id', '', false)`).catch(() => undefined);
  }
}

export async function endOfDayProcessor(payload: { tenantId?: string }): Promise<void> {
  const tenantId = payload?.tenantId;
  if (!tenantId) {
    const ids = await listActiveTenantIds();
    for (const id of ids) {
      try {
        await processEndOfDayTenant(id);
      } catch (err) {
        logger.error({ err, tenantId: id }, 'end-of-day: tenant failed');
      }
    }
    return;
  }
  await processEndOfDayTenant(tenantId);
}
