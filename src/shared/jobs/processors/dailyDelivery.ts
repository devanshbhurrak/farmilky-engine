import { and, eq, isNotNull, lt, lte, ne, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { subscriptions } from '../../db/schema/index.js';
import { tenants } from '../../db/schema/index.js';
import { withTransaction } from '../../db/transaction.js';
import { istToday, round2, toDateOnlyString } from '../../utils/dateUtils.js';
import { logger } from '../../utils/logger.js';
import { getHolidayDateSet } from '../../../modules/holidays/holiday.service.js';
import { generateManifestsForDate } from '../../../modules/manifests/manifest.service.js';
import {
  insertSubscriptionChange,
  updateSubscriptionRow,
} from '../../../modules/subscriptions/subscription.repository.js';
import { calculateNextDeliveryDate } from '../../../modules/subscriptions/subscription.schedule.js';

async function listActiveTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.isActive, true));
  return rows.map((r) => r.id);
}

async function processDailyTenant(tenantId: string): Promise<void> {
  await db.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`);
  try {
    const todayStr = toDateOnlyString(istToday());

    let holidays: Set<number>;
    try {
      holidays = await getHolidayDateSet(tenantId);
    } catch (err) {
      logger.warn({ err, tenantId }, 'daily-delivery: holidays unavailable, continuing without');
      holidays = new Set();
    }

    // Step 1: apply scheduled quantity/price changes due today (active only,
    // with positivity validation — never mutate paused/cancelled subs).
    const dueChanges = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.tenantId, tenantId),
          eq(subscriptions.status, 'active'),
          isNotNull(subscriptions.scheduledChangeDate),
          lte(subscriptions.scheduledChangeDate, todayStr),
        ),
      );
  for (const sub of dueChanges) {
    try {
      const newQty =
        sub.scheduledQty != null ? Number(sub.scheduledQty) : Number(sub.quantityPerDelivery);
      const newPrice =
        sub.scheduledPrice != null ? Number(sub.scheduledPrice) : Number(sub.pricePerPacket);
      if (!(newQty > 0) || !(newPrice >= 0)) {
        throw new Error(`Invalid scheduled values qty=${sub.scheduledQty} price=${sub.scheduledPrice}`);
      }
      await withTransaction(async (tx) => {
        const total = round2(newQty * newPrice);
        const patch: Partial<typeof subscriptions.$inferInsert> = {
          scheduledQty: null,
          scheduledPrice: null,
          scheduledChangeDate: null,
        };
        if (sub.scheduledQty != null) patch.quantityPerDelivery = String(newQty);
        if (sub.scheduledPrice != null) patch.pricePerPacket = newPrice.toFixed(2);
        if (sub.scheduledQty != null || sub.scheduledPrice != null) {
          patch.totalPricePerDelivery = total.toFixed(2);
        }
        await updateSubscriptionRow(tenantId, sub.id, patch, tx);
        await insertSubscriptionChange(
          tenantId,
          {
            subscriptionId: sub.id,
            changeType: 'scheduled_change_applied',
            oldValue: {
              quantityPerDelivery: sub.quantityPerDelivery,
              pricePerPacket: sub.pricePerPacket,
              totalPricePerDelivery: sub.totalPricePerDelivery,
            },
            newValue: {
              quantityPerDelivery: patch.quantityPerDelivery ?? sub.quantityPerDelivery,
              pricePerPacket: patch.pricePerPacket ?? sub.pricePerPacket,
              totalPricePerDelivery: patch.totalPricePerDelivery ?? sub.totalPricePerDelivery,
            },
            effectiveDate: sub.scheduledChangeDate,
            reason: 'Scheduled change applied',
            changedById: null,
          },
          tx,
        );
      });
    } catch (err) {
      logger.error({ err, tenantId, subscriptionId: sub.id }, 'daily-delivery: scheduled change failed');
    }
  }

  // Step 2: auto-cancel subscriptions past their scheduled end date.
  const dueEnds = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, tenantId),
        isNotNull(subscriptions.scheduledEndDate),
        lte(subscriptions.scheduledEndDate, todayStr),
        ne(subscriptions.status, 'cancelled'),
      ),
    );
  for (const sub of dueEnds) {
    try {
      await withTransaction(async (tx) => {
        await updateSubscriptionRow(tenantId, sub.id, { status: 'cancelled' }, tx);
        await insertSubscriptionChange(
          tenantId,
          {
            subscriptionId: sub.id,
            changeType: 'status',
            oldValue: { status: sub.status },
            newValue: { status: 'cancelled' },
            effectiveDate: sub.scheduledEndDate,
            reason: 'Scheduled end date reached',
            changedById: null,
          },
          tx,
        );
      });
    } catch (err) {
      logger.error({ err, tenantId, subscriptionId: sub.id }, 'daily-delivery: auto-cancel failed');
    }
  }

  // Step 3: auto-clear expired vacations and advance nextDeliveryDate.
  const expiredVacations = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, tenantId),
        eq(subscriptions.status, 'active'),
        isNotNull(subscriptions.vacationFrom),
        isNotNull(subscriptions.vacationUntil),
        lt(subscriptions.vacationUntil, todayStr),
      ),
    );
  for (const sub of expiredVacations) {
    try {
      const next = toDateOnlyString(
        calculateNextDeliveryDate(sub, sub.vacationUntil as string, holidays),
      );
      await withTransaction(async (tx) => {
        await updateSubscriptionRow(
          tenantId,
          sub.id,
          { vacationFrom: null, vacationUntil: null, nextDeliveryDate: next },
          tx,
        );
        await insertSubscriptionChange(
          tenantId,
          {
            subscriptionId: sub.id,
            changeType: 'schedule',
            oldValue: { vacationFrom: sub.vacationFrom, vacationUntil: sub.vacationUntil },
            newValue: { vacationFrom: null, vacationUntil: null, nextDeliveryDate: next },
            reason: 'Vacation expired',
            changedById: null,
          },
          tx,
        );
      });
    } catch (err) {
      logger.error({ err, tenantId, subscriptionId: sub.id }, 'daily-delivery: vacation clear failed');
    }
  }

  // Step 4: prune skippedDates older than 7 days.
  const cutoff = toDateOnlyString(new Date(istToday().getTime() - 7 * 24 * 3600 * 1000));
  const allSubs = await db
    .select({
      id: subscriptions.id,
      skippedDates: subscriptions.skippedDates,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId));
  for (const sub of allSubs) {
    const skipped = sub.skippedDates ?? [];
    if (skipped.length === 0) continue;
    const kept = skipped.filter((d) => d >= cutoff);
    if (kept.length === skipped.length) continue;
    try {
      await updateSubscriptionRow(tenantId, sub.id, { skippedDates: kept });
    } catch (err) {
      logger.error({ err, tenantId, subscriptionId: sub.id }, 'daily-delivery: skip prune failed');
    }
  }

  // Step 5: generate today's manifests for both slots.
  let morning: Awaited<ReturnType<typeof generateManifestsForDate>> | undefined;
  let evening: Awaited<ReturnType<typeof generateManifestsForDate>> | undefined;
  try {
    morning = await generateManifestsForDate(tenantId, todayStr, 'morning');
  } catch (err) {
    logger.error({ err, tenantId }, 'daily-delivery: morning manifest generation failed');
  }
  try {
    evening = await generateManifestsForDate(tenantId, todayStr, 'evening');
  } catch (err) {
    logger.error({ err, tenantId }, 'daily-delivery: evening manifest generation failed');
  }
  const skippedAreas = [...(morning?.skippedAreas ?? []), ...(evening?.skippedAreas ?? [])];
  const unassigned = (morning?.unassigned ?? 0) + (evening?.unassigned ?? 0);
  if (skippedAreas.length > 0 || unassigned > 0) {
    logger.warn(
      { tenantId, today: todayStr, skippedAreas, unassigned },
      'daily-delivery: manifests incomplete — review agent assignments',
    );
  }
  } finally {
    await db.execute(sql`SELECT set_config('app.tenant_id', '', false)`).catch(() => undefined);
  }
}

export async function dailyDeliveryProcessor(payload: { tenantId?: string }): Promise<void> {
  const tenantId = payload?.tenantId;
  if (!tenantId) {
    const ids = await listActiveTenantIds();
    for (const id of ids) {
      try {
        await processDailyTenant(id);
      } catch (err) {
        logger.error({ err, tenantId: id }, 'daily-delivery: tenant failed');
      }
    }
    return;
  }
  await processDailyTenant(tenantId);
}
