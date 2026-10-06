import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import {
  areas,
  deliveryManifests,
  manifestEntries,
  orderItems,
  products,
  userAddresses,
  users,
} from '../../shared/db/schema/index.js';

export type ManifestSlot = 'morning' | 'evening';
export type ManifestStatus = (typeof deliveryManifests.status.enumValues)[number];
export type ManifestEntryStatus = (typeof manifestEntries.status.enumValues)[number];

export interface NewManifestEntry {
  entryType: 'subscription' | 'order';
  referenceId: string;
  subscriptionId?: string | null;
  orderId?: string | null;
  customerId?: string | null;
  customerName: string;
  phone?: string | null;
  address?: string | null;
  productLabel: string;
  quantity: string;
  unit: string;
  amount?: string | null;
  sequence?: number | null;
}

// ---------- areas (read directly in this repo file) ----------

export async function listActiveAreas(tenantId: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select()
    .from(areas)
    .where(and(eq(areas.tenantId, tenantId), eq(areas.isActive, true), isNull(areas.deletedAt)))
    .orderBy(areas.sortOrder, areas.name);
}

// ---------- manifests ----------

export async function upsertManifest(
  tenantId: string,
  manifestDate: string,
  slot: ManifestSlot,
  areaId: string,
  agentId: string,
  dbOrTx: DBOrTx = db,
) {
  // Race-safe upsert on (tenant, date, slot, area): concurrent generates for
  // the same sheet converge on one row instead of unique violations.
  const rows = await (dbOrTx as typeof db)
    .insert(deliveryManifests)
    .values({ tenantId, manifestDate, deliverySlot: slot, agentId, areaId, status: 'active' })
    .onConflictDoUpdate({
      target: [
        deliveryManifests.tenantId,
        deliveryManifests.manifestDate,
        deliveryManifests.deliverySlot,
        deliveryManifests.areaId,
      ],
      set: { agentId, updatedAt: new Date() },
    })
    .returning();
  return rows[0]!;
}

export async function updateManifestStatus(
  tenantId: string,
  manifestId: string,
  status: ManifestStatus,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(deliveryManifests)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(deliveryManifests.tenantId, tenantId), eq(deliveryManifests.id, manifestId)))
    .returning();
  return rows[0];
}

export async function findManifestRow(tenantId: string, id: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(deliveryManifests)
    .where(and(eq(deliveryManifests.tenantId, tenantId), eq(deliveryManifests.id, id)))
    .limit(1);
  return rows[0];
}

async function listEntriesForManifests(manifestIds: string[], dbOrTx: DBOrTx) {
  if (manifestIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select()
    .from(manifestEntries)
    .where(inArray(manifestEntries.manifestId, manifestIds))
    .orderBy(sql`${manifestEntries.sequence} ASC NULLS LAST`, manifestEntries.customerName);
}

function attachAgentArea(
  manifest: typeof deliveryManifests.$inferSelect,
  agent: { id: string; name: string; phone: string } | null,
  area: { id: string; name: string } | null,
  entries: (typeof manifestEntries.$inferSelect)[],
) {
  return { ...manifest, agent, area, entries };
}

export async function findManifestById(tenantId: string, id: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ manifest: deliveryManifests, agent: users, area: areas })
    .from(deliveryManifests)
    .leftJoin(users, eq(users.id, deliveryManifests.agentId))
    .leftJoin(areas, eq(areas.id, deliveryManifests.areaId))
    .where(and(eq(deliveryManifests.tenantId, tenantId), eq(deliveryManifests.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const entries = await listEntriesForManifests([id], dbOrTx);
  return attachAgentArea(
    row.manifest,
    row.agent ? { id: row.agent.id, name: row.agent.name, phone: row.agent.phone } : null,
    row.area ? { id: row.area.id, name: row.area.name } : null,
    entries,
  );
}

export async function listManifestsByDate(
  tenantId: string,
  date: string,
  slot: ManifestSlot | undefined,
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(deliveryManifests.tenantId, tenantId), eq(deliveryManifests.manifestDate, date)];
  if (slot) conditions.push(eq(deliveryManifests.deliverySlot, slot));
  const rows = await (dbOrTx as typeof db)
    .select({ manifest: deliveryManifests, agent: users, area: areas })
    .from(deliveryManifests)
    .leftJoin(users, eq(users.id, deliveryManifests.agentId))
    .leftJoin(areas, eq(areas.id, deliveryManifests.areaId))
    .where(and(...conditions))
    .orderBy(areas.name);
  const entries = await listEntriesForManifests(
    rows.map((r) => r.manifest.id),
    dbOrTx,
  );
  const byManifest = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byManifest.get(e.manifestId) ?? [];
    list.push(e);
    byManifest.set(e.manifestId, list);
  }
  return rows.map((r) =>
    attachAgentArea(
      r.manifest,
      r.agent ? { id: r.agent.id, name: r.agent.name, phone: r.agent.phone } : null,
      r.area ? { id: r.area.id, name: r.area.name } : null,
      byManifest.get(r.manifest.id) ?? [],
    ),
  );
}

export async function findMyToday(
  tenantId: string,
  agentId: string,
  date: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select({ manifest: deliveryManifests, area: areas })
    .from(deliveryManifests)
    .leftJoin(areas, eq(areas.id, deliveryManifests.areaId))
    .where(
      and(
        eq(deliveryManifests.tenantId, tenantId),
        eq(deliveryManifests.agentId, agentId),
        eq(deliveryManifests.manifestDate, date),
      ),
    )
    .orderBy(deliveryManifests.deliverySlot);
  const entries = await listEntriesForManifests(
    rows.map((r) => r.manifest.id),
    dbOrTx,
  );
  const byManifest = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byManifest.get(e.manifestId) ?? [];
    list.push(e);
    byManifest.set(e.manifestId, list);
  }
  return rows.map((r) =>
    attachAgentArea(
      r.manifest,
      null,
      r.area ? { id: r.area.id, name: r.area.name } : null,
      byManifest.get(r.manifest.id) ?? [],
    ),
  );
}

export async function historyManifests(
  tenantId: string,
  agentId: string,
  fromDate: string,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .select({ manifest: deliveryManifests, area: areas })
    .from(deliveryManifests)
    .leftJoin(areas, eq(areas.id, deliveryManifests.areaId))
    .where(
      and(
        eq(deliveryManifests.tenantId, tenantId),
        eq(deliveryManifests.agentId, agentId),
        gte(deliveryManifests.manifestDate, fromDate),
      ),
    )
    .orderBy(desc(deliveryManifests.manifestDate));
  const entries = await listEntriesForManifests(
    rows.map((r) => r.manifest.id),
    dbOrTx,
  );
  const byManifest = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byManifest.get(e.manifestId) ?? [];
    list.push(e);
    byManifest.set(e.manifestId, list);
  }
  return rows.map((r) =>
    attachAgentArea(
      r.manifest,
      null,
      r.area ? { id: r.area.id, name: r.area.name } : null,
      byManifest.get(r.manifest.id) ?? [],
    ),
  );
}

export async function findIncomplete(tenantId: string, date: string, dbOrTx: DBOrTx = db) {
  return (dbOrTx as typeof db)
    .select({
      manifest: deliveryManifests,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${manifestEntries.status} = 'pending')`,
    })
    .from(deliveryManifests)
    .leftJoin(manifestEntries, eq(manifestEntries.manifestId, deliveryManifests.id))
    .where(
      and(
        eq(deliveryManifests.tenantId, tenantId),
        eq(deliveryManifests.manifestDate, date),
        ne(deliveryManifests.status, 'completed'),
      ),
    )
    .groupBy(deliveryManifests.id);
}

// ---------- entries ----------

export async function insertEntriesMany(
  tenantId: string,
  manifestId: string,
  entries: NewManifestEntry[],
  dbOrTx: DBOrTx = db,
) {
  if (entries.length === 0) return [];
  return (dbOrTx as typeof db)
    .insert(manifestEntries)
    .values(
      entries.map((e) => ({
        tenantId,
        manifestId,
        entryType: e.entryType,
        referenceId: e.referenceId,
        subscriptionId: e.subscriptionId ?? null,
        orderId: e.orderId ?? null,
        customerId: e.customerId ?? null,
        customerName: e.customerName,
        phone: e.phone ?? null,
        address: e.address ?? null,
        productLabel: e.productLabel,
        quantity: e.quantity,
        unit: e.unit,
        amount: e.amount ?? null,
        sequence: e.sequence ?? null,
      })),
    )
    .returning();
}

export async function getExistingRefs(manifestId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ entryType: manifestEntries.entryType, referenceId: manifestEntries.referenceId })
    .from(manifestEntries)
    .where(eq(manifestEntries.manifestId, manifestId));
  return new Set(rows.map((r) => `${r.entryType}:${r.referenceId}`));
}

export async function getMaxSequence(manifestId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: sql<number | null>`MAX(${manifestEntries.sequence})` })
    .from(manifestEntries)
    .where(eq(manifestEntries.manifestId, manifestId));
  const value = rows[0]?.value;
  return value == null ? null : Number(value);
}

export async function findEntryWithManifest(entryId: string, tenantId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ entry: manifestEntries, manifest: deliveryManifests })
    .from(manifestEntries)
    .innerJoin(deliveryManifests, eq(deliveryManifests.id, manifestEntries.manifestId))
    .where(and(eq(manifestEntries.id, entryId), eq(deliveryManifests.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function updateEntry(
  entryId: string,
  tenantId: string,
  patch: Partial<{
    status: ManifestEntryStatus;
    deliveryNotes: string | null;
    failureReason: string | null;
    deliveredAt: Date | null;
  }>,
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(manifestEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(manifestEntries.id, entryId), eq(manifestEntries.tenantId, tenantId)))
    .returning();
  return rows[0];
}

export async function countPending(manifestId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select({ value: sql<number>`COUNT(*)` })
    .from(manifestEntries)
    .where(and(eq(manifestEntries.manifestId, manifestId), eq(manifestEntries.status, 'pending')));
  return Number(rows[0]?.value ?? 0);
}

export async function listPendingEntries(
  manifestId: string,
  tenantId: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .select()
    .from(manifestEntries)
    .where(
      and(
        eq(manifestEntries.manifestId, manifestId),
        eq(manifestEntries.tenantId, tenantId),
        eq(manifestEntries.status, 'pending'),
      ),
    );
}

export async function markPendingAsFailed(
  manifestId: string,
  reason: string,
  dbOrTx: DBOrTx = db,
) {
  return (dbOrTx as typeof db)
    .update(manifestEntries)
    .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
    .where(and(eq(manifestEntries.manifestId, manifestId), eq(manifestEntries.status, 'pending')))
    .returning({ id: manifestEntries.id });
}

export async function resequenceEntries(
  manifestId: string,
  tenantId: string,
  orderedEntryIds: string[],
  dbOrTx: DBOrTx = db,
) {
  const manifest = await findManifestRow(tenantId, manifestId, dbOrTx);
  if (!manifest) throw new Error('MANIFEST_NOT_FOUND');
  if (new Set(orderedEntryIds).size !== orderedEntryIds.length) {
    throw new Error('DUPLICATE_ENTRY_IDS');
  }
  const existing = await (dbOrTx as typeof db)
    .select({ id: manifestEntries.id })
    .from(manifestEntries)
    .where(eq(manifestEntries.manifestId, manifestId));
  const known = new Set(existing.map((e) => e.id));
  for (const id of orderedEntryIds) {
    if (!known.has(id)) throw new Error(`ENTRY_NOT_FOUND:${id}`);
  }
  const ordered = new Set(orderedEntryIds);
  for (let i = 0; i < orderedEntryIds.length; i += 1) {
    await (dbOrTx as typeof db)
      .update(manifestEntries)
      .set({ sequence: i + 1, updatedAt: new Date() })
      .where(eq(manifestEntries.id, orderedEntryIds[i]!));
  }
  for (const e of existing) {
    if (!ordered.has(e.id)) {
      await (dbOrTx as typeof db)
        .update(manifestEntries)
        .set({ sequence: null, updatedAt: new Date() })
        .where(eq(manifestEntries.id, e.id));
    }
  }
}

// ---------- lookup maps for generation ----------

export async function findUsersAreaMap(tenantId: string, userIds: string[], dbOrTx: DBOrTx = db) {
  if (userIds.length === 0) return new Map<string, { assignedAreaId: string | null; name: string; phone: string }>();
  const rows = await (dbOrTx as typeof db)
    .select({
      id: users.id,
      assignedAreaId: users.assignedAreaId,
      name: users.name,
      phone: users.phone,
    })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, [...new Set(userIds)])));
  return new Map(rows.map((r) => [r.id, { assignedAreaId: r.assignedAreaId, name: r.name, phone: r.phone }]));
}

export async function findDefaultAddresses(
  tenantId: string,
  userIds: string[],
  dbOrTx: DBOrTx = db,
) {
  if (userIds.length === 0) return new Map<string, { street: string | null; city: string | null; pincode: string | null }>();
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(userAddresses)
    .where(and(eq(userAddresses.tenantId, tenantId), inArray(userAddresses.userId, [...new Set(userIds)])));
  const byUser = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  const result = new Map<string, { street: string | null; city: string | null; pincode: string | null }>();
  for (const [userId, list] of byUser) {
    const chosen = list.find((a) => a.isDefault) ?? list[0]!;
    result.set(userId, { street: chosen.street, city: chosen.city, pincode: chosen.pincode });
  }
  return result;
}

export async function findProductsMap(tenantId: string, productIds: string[], dbOrTx: DBOrTx = db) {
  if (productIds.length === 0) return new Map<string, { name: string; unit: string }>();
  const rows = await (dbOrTx as typeof db)
    .select({ id: products.id, name: products.name, unit: products.unit })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, [...new Set(productIds)])));
  return new Map(rows.map((r) => [r.id, { name: r.name, unit: r.unit }]));
}

export async function findOrderItemsMany(orderIds: string[], dbOrTx: DBOrTx = db) {
  if (orderIds.length === 0) return [];
  return (dbOrTx as typeof db)
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, [...new Set(orderIds)]));
}
