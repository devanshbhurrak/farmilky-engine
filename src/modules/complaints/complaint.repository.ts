import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { complaints } from '../../shared/db/schema/index.js';

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface NewComplaint {
  userId: string;
  relatedTo: 'order' | 'subscription' | 'delivery' | 'product' | 'other';
  referenceId?: string | null;
  referenceType?: 'order' | 'subscription' | 'delivery_manifest' | 'product' | null;
  subject: string;
  description: string;
}

export async function insertComplaint(tenantId: string, data: NewComplaint, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .insert(complaints)
    .values({
      tenantId,
      userId: data.userId,
      relatedTo: data.relatedTo,
      referenceId: data.referenceId ?? null,
      referenceType: data.referenceType ?? null,
      subject: data.subject,
      description: data.description,
    })
    .returning();
  return rows[0]!;
}

export async function findComplaintById(tenantId: string, complaintId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(complaints)
    .where(and(eq(complaints.tenantId, tenantId), eq(complaints.id, complaintId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ComplaintListOpts {
  limit: number;
  offset: number;
  status?: ComplaintStatus;
}

export async function listComplaintsByUser(
  tenantId: string,
  userId: string,
  opts: ComplaintListOpts,
  dbOrTx: DBOrTx = db,
) {
  const conds = [eq(complaints.tenantId, tenantId), eq(complaints.userId, userId)];
  if (opts.status) conds.push(eq(complaints.status, opts.status));
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(complaints)
    .where(and(...conds))
    .orderBy(desc(complaints.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(complaints)
    .where(and(...conds));
  return { rows, total };
}

export async function listAllComplaints(tenantId: string, opts: ComplaintListOpts, dbOrTx: DBOrTx = db) {
  const conds = [eq(complaints.tenantId, tenantId)];
  if (opts.status) conds.push(eq(complaints.status, opts.status));
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(complaints)
    .where(and(...conds))
    .orderBy(desc(complaints.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(complaints)
    .where(and(...conds));
  return { rows, total };
}

export async function updateComplaintRow(
  tenantId: string,
  complaintId: string,
  patch: {
    status?: ComplaintStatus;
    resolution?: string | null;
    resolvedAt?: Date | null;
    resolvedById?: string | null;
  },
  dbOrTx: DBOrTx = db,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.resolution !== undefined) set.resolution = patch.resolution;
  if (patch.resolvedAt !== undefined) set.resolvedAt = patch.resolvedAt;
  if (patch.resolvedById !== undefined) set.resolvedById = patch.resolvedById;
  const rows = await (dbOrTx as typeof db)
    .update(complaints)
    .set(set)
    .where(and(eq(complaints.tenantId, tenantId), eq(complaints.id, complaintId)))
    .returning();
  return rows[0] ?? null;
}
