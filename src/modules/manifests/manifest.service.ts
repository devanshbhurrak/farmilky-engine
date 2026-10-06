import { db } from '../../shared/db/client.js';
import { withTransaction } from '../../shared/db/transaction.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { sseManager } from '../../shared/realtime/sseManager.js';
import { logger } from '../../shared/utils/logger.js';
import type { DBOrTx, DrizzleTx } from '../../shared/types/index.js';
import { addDays, istToday, normalizeDate, toDateOnlyString } from '../../shared/utils/dateUtils.js';
import { listPendingForDateSlot, recordDeliveryOutcome as recordOrderOutcome } from '../orders/order.service.js';
import { getHolidayDateSet } from '../holidays/holiday.service.js';
import {
  isSubscriptionDueOnDate,
  recordDeliveryOutcome as recordSubscriptionOutcome,
} from '../subscriptions/subscription.service.js';
import { listActiveSubscriptionsDue } from '../subscriptions/subscription.repository.js';
import type { UpdateEntryInput } from './manifest.schema.js';
import {
  countPending,
  findDefaultAddresses,
  findEntryWithManifest,
  findIncomplete,
  findManifestById,
  findMyToday,
  findOrderItemsMany,
  findProductsMap,
  findUsersAreaMap,
  getExistingRefs,
  getMaxSequence,
  historyManifests,
  insertEntriesMany,
  listActiveAreas,
  listManifestsByDate,
  resequenceEntries,
  updateEntry,
  updateManifestStatus,
  upsertManifest,
  type ManifestSlot,
  type NewManifestEntry,
} from './manifest.repository.js';

export type { ManifestSlot };

export interface SkippedArea {
  areaId: string;
  areaName: string;
  reason: string;
}

export interface GenerateResult {
  manifests: Exclude<Awaited<ReturnType<typeof findManifestById>>, null>[];
  skippedAreas: SkippedArea[];
  unassigned: number;
  skipped: boolean;
  reason?: string;
}

function joinAddress(parts: Array<string | null | undefined>): string | null {
  const joined = parts.filter((p): p is string => !!p && p.trim() !== '').join(', ');
  return joined === '' ? null : joined;
}

// ---------- generation ----------

export async function generateManifestsForDate(
  tenantId: string,
  date: string,
  slot: ManifestSlot,
  dbOrTx: DBOrTx = db,
  outerTx?: DrizzleTx,
): Promise<GenerateResult> {
  const holidays = await getHolidayDateSet(tenantId, dbOrTx);
  if (holidays.has(normalizeDate(date).getTime())) {
    return { manifests: [], skippedAreas: [], unassigned: 0, skipped: true, reason: 'holiday' };
  }

  const areaList = await listActiveAreas(tenantId, dbOrTx);
  const areaById = new Map(areaList.map((a) => [a.id, a]));

  const candidates = await listActiveSubscriptionsDue(tenantId, { maxNextDate: date, slot }, dbOrTx);
  const dueSubs = candidates.filter((s) => isSubscriptionDueOnDate(s, date, holidays));
  const pendingOrders = await listPendingForDateSlot(tenantId, date, slot, dbOrTx);

  const userIds = [
    ...new Set([...dueSubs.map((s) => s.userId), ...pendingOrders.map((o) => o.userId)]),
  ];
  const [userMap, addressMap, productMap, orderItems] = await Promise.all([
    findUsersAreaMap(tenantId, userIds, dbOrTx),
    findDefaultAddresses(tenantId, userIds, dbOrTx),
    findProductsMap(
      tenantId,
      [...new Set(dueSubs.map((s) => s.productId))],
      dbOrTx,
    ),
    findOrderItemsMany(
      pendingOrders.map((o) => o.id),
      dbOrTx,
    ),
  ]);
  const itemsByOrder = new Map<string, typeof orderItems>();
  for (const item of orderItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  const byArea = new Map<string, NewManifestEntry[]>();
  let unassigned = 0;
  const pushDraft = (areaId: string | null | undefined, draft: NewManifestEntry) => {
    if (!areaId || !areaById.has(areaId)) {
      unassigned += 1;
      return;
    }
    const list = byArea.get(areaId) ?? [];
    list.push(draft);
    byArea.set(areaId, list);
  };

  for (const sub of dueSubs) {
    const customer = userMap.get(sub.userId);
    const addr = addressMap.get(sub.userId);
    const product = productMap.get(sub.productId);
    pushDraft(sub.areaId ?? customer?.assignedAreaId ?? null, {
      entryType: 'subscription',
      referenceId: sub.id,
      subscriptionId: sub.id,
      orderId: null,
      customerId: sub.userId,
      customerName: customer?.name ?? 'Unknown',
      phone: customer?.phone ?? null,
      address: joinAddress([addr?.street, addr?.city, addr?.pincode]),
      productLabel: `${product?.name ?? 'Unknown'}${sub.variantLabel ? ` (${sub.variantLabel})` : ''}`,
      quantity: String(sub.quantityPerDelivery),
      unit: sub.variantUnit ?? product?.unit ?? 'unit',
      amount: sub.totalPricePerDelivery,
    });
  }

  for (const order of pendingOrders) {
    const customer = userMap.get(order.userId);
    const items = itemsByOrder.get(order.id) ?? [];
    const label =
      items.length > 0
        ? items
            .map(
              (i) =>
                `${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.quantity}`,
            )
            .join(', ')
        : 'Order items';
    const quantity = items.reduce((sum, i) => sum + Number(i.quantity), 0);
    // Fall back to the customer's assigned area when the order has none —
    // same policy as subscriptions — so area-less orders still manifest.
    pushDraft(order.areaId ?? customer?.assignedAreaId ?? null, {
      entryType: 'order',
      referenceId: order.id,
      subscriptionId: null,
      orderId: order.id,
      customerId: order.userId,
      customerName: customer?.name ?? 'Unknown',
      phone: customer?.phone ?? null,
      address: joinAddress([order.addressStreet, order.addressCity, order.addressPincode]),
      productLabel: label,
      quantity: String(quantity),
      unit: 'items',
      amount: order.totalAmount,
    });
  }

  const manifests: GenerateResult['manifests'] = [];
  const skippedAreas: SkippedArea[] = [];
  for (const area of areaList) {
    const drafts = byArea.get(area.id) ?? [];
    if (drafts.length === 0) continue;
    if (!area.assignedAgentId) {
      skippedAreas.push({ areaId: area.id, areaName: area.name, reason: 'No agent assigned to area' });
      continue;
    }
    const agentId = area.assignedAgentId;
    const writeArea = async (tx: DrizzleTx) => {
      const manifest = await upsertManifest(tenantId, date, slot, area.id, agentId, tx);
      // Refresh-safe: only insert entries that are not already on the sheet.
      const existing = await getExistingRefs(manifest.id, tx);
      const missing = drafts.filter((d) => !existing.has(`${d.entryType}:${d.referenceId}`));
      if (missing.length > 0) {
        const maxSeq = (await getMaxSequence(manifest.id, tx)) ?? 0;
        await insertEntriesMany(
          tenantId,
          manifest.id,
          missing.map((d, i) => ({ ...d, sequence: maxSeq + i + 1 })),
          tx,
        );
      }
      // Late arrivals reopen a completed sheet so nothing is silently dropped.
      if (missing.length > 0 || manifest.status === 'draft') {
        if (manifest.status !== 'active') {
          await updateManifestStatus(tenantId, manifest.id, 'active', tx);
        }
      }
      return manifest.id;
    };
    const manifestId = outerTx ? await writeArea(outerTx) : await withTransaction(writeArea);
    const full = await findManifestById(tenantId, manifestId, dbOrTx);
    if (full) manifests.push(full);
  }

  if (skippedAreas.length > 0 || unassigned > 0) {
    logger.warn(
      { tenantId, date, slot, skippedAreas, unassigned },
      'Manifest generation skipped areas/entries — review agent assignments',
    );
  }

  return { manifests, skippedAreas, unassigned, skipped: false };
}

export async function generateManifests(
  tenantId: string,
  date: string,
  slot: ManifestSlot | 'both',
  dbOrTx: DBOrTx = db,
  outerTx?: DrizzleTx,
): Promise<GenerateResult> {
  if (slot !== 'both') return generateManifestsForDate(tenantId, date, slot, dbOrTx, outerTx);
  const morning = await generateManifestsForDate(tenantId, date, 'morning', dbOrTx, outerTx);
  const evening = await generateManifestsForDate(tenantId, date, 'evening', dbOrTx, outerTx);
  const skipped = morning.skipped && evening.skipped;
  return {
    manifests: [...morning.manifests, ...evening.manifests],
    skippedAreas: [...morning.skippedAreas, ...evening.skippedAreas],
    unassigned: morning.unassigned + evening.unassigned,
    skipped,
    ...(skipped ? { reason: 'holiday' } : {}),
  };
}

// ---------- entry outcome ----------

export async function updateManifestEntry(
  tenantId: string,
  entryId: string,
  data: UpdateEntryInput,
  actor: { id: string; role: string } | string,
  tx?: DrizzleTx,
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  const actorRole = typeof actor === 'string' ? 'admin' : actor.role;
  const run = async (t: DrizzleTx) => {
    const found = await findEntryWithManifest(entryId, tenantId, t);
    if (!found) throw new AppError('Manifest entry not found', 404);
    const { entry, manifest } = found;
    // Agents can only update pending entries; admins can also correct skipped/failed entries.
    if (actorRole === 'admin') {
      if (entry.status === 'delivered') throw new AppError('Entry is already delivered and cannot be changed', 409);
    } else {
      if (entry.status !== 'pending') throw new AppError('Entry already actioned', 409);
    }
    // Agents may only action their own manifest; admins bypass.
    if (actorRole !== 'admin' && manifest.agentId !== actorId) {
      throw new AppError('You are not assigned to this manifest', 403);
    }

    const reason = data.failureReason ?? data.reason ?? null;
    // Manifest entries only store delivered|failed|skipped; partial/extra
    // outcomes are stored as delivered on the entry but recorded in full on
    // the underlying subscription (quantity-correct billing).
    const entryStatus =
      data.status === 'partial' || data.status === 'extra' ? 'delivered' : data.status;
    if (entry.entryType === 'subscription') {
      if (!entry.subscriptionId) throw new AppError('Subscription reference missing on entry', 422);
      await recordSubscriptionOutcome(
        entry.subscriptionId,
        tenantId,
        {
          deliveryDate: manifest.manifestDate,
          status: data.status,
          ...(data.actualQuantity !== undefined ? { actualQuantity: data.actualQuantity } : {}),
          ...(reason ? { reason } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
        },
        actorId,
        t,
      );
    } else {
      if (!entry.orderId) throw new AppError('Order reference missing on entry', 422);
      // NOTE: order service signature is (tenantId, orderId, input, actorId, tx).
      await recordOrderOutcome(
        tenantId,
        entry.orderId,
        {
          status: entryStatus,
          ...(reason ? { reason } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
          attemptDate: manifest.manifestDate,
          effectiveDate: manifest.manifestDate,
        },
        actorId,
        t,
      );
    }

    const updated = await updateEntry(
      entry.id,
      tenantId,
      {
        status: entryStatus,
        ...(data.notes !== undefined ? { deliveryNotes: data.notes } : {}),
        ...(reason ? { failureReason: reason } : {}),
        ...(entryStatus === 'delivered' ? { deliveredAt: new Date() } : {}),
      },
      t,
    );
    const pending = await countPending(manifest.id, t);
    let manifestComplete = false;
    if (pending === 0) {
      await updateManifestStatus(tenantId, manifest.id, 'completed', t);
      manifestComplete = true;
    }
    return { entry: updated, manifestComplete, manifest };
  };
  const result = tx ? await run(tx) : await withTransaction(run);
  // Refresh the covering invoice once the ledger write is committed.
  if (result.entry.customerId) {
    void import('../invoices/invoice.service.js')
      .then((mod) =>
        (
          mod as { syncInvoiceStatusAfterPayment?: (t: string, u: string) => unknown }
        ).syncInvoiceStatusAfterPayment?.(tenantId, result.entry.customerId as string),
      )
      .catch(() => undefined);
  }
  try {
    sseManager.broadcast(
      `${tenantId}:${result.manifest.areaId}:${result.manifest.manifestDate}:${result.manifest.deliverySlot}`,
      { type: 'entry_updated', entryId, status: data.status, manifestComplete: result.manifestComplete },
    );
  } catch (err) {
    logger.error({ err, entryId }, 'SSE broadcast failed after manifest entry update');
  }
  return { entry: result.entry, manifestComplete: result.manifestComplete, manifest: result.manifest };
}

// ---------- queries ----------

export async function listManifestsByDateService(
  tenantId: string,
  date: string,
  slot: ManifestSlot | undefined,
  dbOrTx: DBOrTx = db,
) {
  return listManifestsByDate(tenantId, date, slot, dbOrTx);
}

export async function getManifestService(tenantId: string, id: string, dbOrTx: DBOrTx = db) {
  const manifest = await findManifestById(tenantId, id, dbOrTx);
  if (!manifest) throw new AppError('Manifest not found', 404);
  return manifest;
}

export async function getMyTodayService(tenantId: string, agentId: string, dbOrTx: DBOrTx = db) {
  const date = toDateOnlyString(istToday());
  const manifests = await findMyToday(tenantId, agentId, date, dbOrTx);
  if (manifests.length === 0) throw new AppError('No manifest assigned for today.', 404);
  return { date, manifests };
}

export async function getHistoryService(
  tenantId: string,
  agentId: string,
  fromDate: string | undefined,
  dbOrTx: DBOrTx = db,
) {
  // Cap history at 90 days: clamp any older fromDate forward.
  const minDate = toDateOnlyString(addDays(istToday(), -90));
  let from = fromDate ?? toDateOnlyString(addDays(istToday(), -7));
  if (from < minDate) from = minDate;
  const manifests = await historyManifests(tenantId, agentId, from, dbOrTx);
  return { fromDate: from, count: manifests.length, manifests };
}

export async function resequenceService(
  tenantId: string,
  id: string,
  orderedEntryIds: string[],
  tx?: DrizzleTx,
) {
  const run = async (t: DBOrTx) => {
    try {
      await resequenceEntries(id, tenantId, orderedEntryIds, t);
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : '';
      if (message === 'MANIFEST_NOT_FOUND') throw new AppError('Manifest not found', 404);
      if (message === 'DUPLICATE_ENTRY_IDS') {
        throw new AppError('Duplicate entry IDs in orderedEntryIds.', 400);
      }
      if (message.startsWith('ENTRY_NOT_FOUND:')) {
        throw new AppError(
          `Entry ${message.slice('ENTRY_NOT_FOUND:'.length)} not found in manifest.`,
          400,
        );
      }
      throw err;
    }
    const manifest = await findManifestById(tenantId, id, t);
    if (!manifest) throw new AppError('Manifest not found', 404);
    return manifest;
  };
  if (tx) return run(tx);
  return withTransaction((t) => run(t));
}

export async function findIncompleteService(tenantId: string, date: string, dbOrTx: DBOrTx = db) {
  const rows = await findIncomplete(tenantId, date, dbOrTx);
  return rows.map((r) => ({ manifest: r.manifest, pendingCount: Number(r.pendingCount ?? 0) }));
}
