import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { contactMessages, tenants } from '../../shared/db/schema/index.js';

export async function findTenantBySlug(slug: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return rows[0];
}

export async function createMessageRow(
  tenantId: string,
  data: { name: string; email: string; message: string },
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .insert(contactMessages)
    .values({ tenantId, name: data.name, email: data.email, message: data.message })
    .returning();
  return rows[0]!;
}

export async function listMessages(
  tenantId: string,
  opts: { status?: string; limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(contactMessages.tenantId, tenantId)];
  if (opts.status) {
    conditions.push(
      eq(contactMessages.status, opts.status as typeof contactMessages.status.enumValues[number]),
    );
  }
  return (dbOrTx as typeof db)
    .select()
    .from(contactMessages)
    .where(and(...conditions))
    .orderBy(desc(contactMessages.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function countMessages(
  tenantId: string,
  opts: { status?: string },
  dbOrTx: DBOrTx = db,
) {
  const conditions = [eq(contactMessages.tenantId, tenantId)];
  if (opts.status) {
    conditions.push(
      eq(contactMessages.status, opts.status as typeof contactMessages.status.enumValues[number]),
    );
  }
  const rows = await (dbOrTx as typeof db)
    .select({ value: count() })
    .from(contactMessages)
    .where(and(...conditions));
  return rows[0]?.value ?? 0;
}

export async function findMessageById(tenantId: string, messageId: string, dbOrTx: DBOrTx = db) {
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(contactMessages)
    .where(and(eq(contactMessages.tenantId, tenantId), eq(contactMessages.id, messageId)))
    .limit(1);
  return rows[0];
}

export async function updateMessageStatusRow(
  tenantId: string,
  messageId: string,
  status: typeof contactMessages.status.enumValues[number],
  dbOrTx: DBOrTx = db,
) {
  const rows = await (dbOrTx as typeof db)
    .update(contactMessages)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(contactMessages.tenantId, tenantId), eq(contactMessages.id, messageId)))
    .returning();
  return rows[0];
}
