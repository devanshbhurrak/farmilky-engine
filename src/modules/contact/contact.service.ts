import { db } from '../../shared/db/client.js';
import { AppError } from '../../shared/middleware/errorHandler.js';
import type { DBOrTx } from '../../shared/types/index.js';
import type { CreateContactInput } from './contact.schema.js';
import {
  countMessages,
  createMessageRow,
  findMessageById,
  findTenantBySlug,
  listMessages,
  updateMessageStatusRow,
} from './contact.repository.js';

export async function createContactMessage(
  input: CreateContactInput,
  headerSlug: string | undefined | null,
  dbOrTx: DBOrTx = db,
) {
  const slug = input.tenantSlug ?? headerSlug ?? undefined;
  if (!slug) throw new AppError('Tenant slug is required', 400);
  const tenant = await findTenantBySlug(slug, dbOrTx);
  if (!tenant) throw new AppError('Unknown tenant', 400);
  return createMessageRow(
    tenant.id,
    { name: input.name, email: input.email, message: input.message },
    dbOrTx,
  );
}

export async function listContactMessagesService(
  tenantId: string,
  opts: { status?: string; page: number; limit: number; offset: number },
  dbOrTx: DBOrTx = db,
) {
  const [items, total] = await Promise.all([
    listMessages(tenantId, { status: opts.status, limit: opts.limit, offset: opts.offset }, dbOrTx),
    countMessages(tenantId, { status: opts.status }, dbOrTx),
  ]);
  return { items, total };
}

export async function updateContactStatusService(
  tenantId: string,
  messageId: string,
  status: 'unread' | 'read' | 'replied',
  dbOrTx: DBOrTx = db,
) {
  const existing = await findMessageById(tenantId, messageId, dbOrTx);
  if (!existing) throw new AppError('Contact message not found', 404);
  const updated = await updateMessageStatusRow(tenantId, messageId, status, dbOrTx);
  if (!updated) throw new AppError('Contact message not found', 404);
  return updated;
}
