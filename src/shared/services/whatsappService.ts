/**
 * WhatsApp invoice delivery (stub).
 * Renders the PDF to prove the pipeline works, logs the send, then marks the
 * invoice sent. Replace the stub block with a real Twilio/WhatsApp Business
 * API call when credentials are available.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { generateInvoicePDF } from './pdfService.js';
import * as invoiceRepo from '../../modules/invoices/invoice.repository.js';

export async function sendInvoiceViaWhatsApp(
  tenantId: string,
  invoiceId: string,
  _adminId?: string,
): Promise<{ success: boolean; stub: boolean; message: string }> {
  const invoice = await invoiceRepo.findById(tenantId, invoiceId, db);
  if (!invoice) throw new AppError('Invoice not found', 404);

  const userRows = await db
    .select({ name: users.name, phone: users.phone })
    .from(users)
    .where(and(eq(users.id, invoice.userId), eq(users.tenantId, tenantId)))
    .limit(1);
  const customer = userRows[0];
  if (!customer?.phone) throw new AppError('Customer phone number not available', 400);

  const pdfBuffer = await generateInvoicePDF(invoice.id, { tenantId, detailed: false });

  // ── Stub: replace with a real WhatsApp API call (e.g. Twilio) ──
  logger.info(
    { invoiceNumber: invoice.invoiceNumber, phone: customer.phone, bytes: pdfBuffer.length },
    `[WhatsApp:stub] Sending invoice ${invoice.invoiceNumber} to ${customer.phone} (${pdfBuffer.length} bytes)`,
  );
  // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // await client.messages.create({
  //   from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
  //   to: `whatsapp:+91${customer.phone}`,
  //   mediaUrl: [await uploadPdfToStorage(pdfBuffer)],
  //   body: `Hi ${customer.name}, your Farmilky invoice ${invoice.invoiceNumber} is attached.`,
  // });
  // ────────────────────────────────────────────────────────────────

  await invoiceRepo.updateInvoice(
    tenantId,
    invoiceId,
    {
      sentAt: new Date(),
      sentVia: 'whatsapp',
      ...(invoice.status === 'draft' ? { status: 'sent' as const } : {}),
    },
    db,
  );

  return {
    success: true,
    stub: true,
    message: `Invoice ${invoice.invoiceNumber} queued for WhatsApp delivery to ${customer.phone}`,
  };
}
