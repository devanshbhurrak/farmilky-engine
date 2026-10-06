/**
 * PDF Invoice Generator — Farmilky (backend-v2 port).
 * Renders a branded A4 invoice: header → customer/meta boxes → invoice
 * summary → product summary → transaction ledger (detailed only) → notes →
 * payment options (UPI QR). Accepts both the v2 drizzle row shape and the
 * legacy mongoose shape via a normalizer.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invoiceLineItems, invoiceProductSummary, invoices, tenants, users } from '../db/schema/index.js';
import type { DBOrTx } from '../types/index.js';

// ── Public input types ──────────────────────────────────────────────────────
export interface PdfCustomer {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface PdfLineItem {
  date?: string | Date | null;
  entryDate?: string | Date | null;
  description?: string | null;
  category?: string | null;
  productName?: string | null;
  variantLabel?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  unitPrice?: string | number | null;
  amount?: string | number | null;
  entryType?: string | null;
}

export interface PdfProductRow {
  productId?: string | null;
  productName?: string | null;
  variantLabel?: string | null;
  unit?: string | null;
  totalQuantity?: string | number | null;
  avgRate?: string | number | null;
  totalAmount?: string | number | null;
  paidAmount?: string | number | null;
  outstandingAmount?: string | number | null;
  rateBreakdown?: Array<{ rate: number; quantity: number; amount: number }>;
}

export interface PdfTenant {
  name?: string | null;
  brandPhone?: string | null;
  upiId?: string | null;
  upiName?: string | null;
  brandLogoUrl?: string | null;
}

export interface PdfInvoice {
  id?: string;
  invoiceNumber: string;
  status?: string | null;
  billingMonth?: number | null;
  billingYear?: number | null;
  billingPeriod?: { month: number; year: number } | null;
  previousBalance?: string | number | null;
  totalCharges?: string | number | null;
  orderCredits?: string | number | null;
  totalPayments?: string | number | null;
  totalAdjustments?: string | number | null;
  netAmountDue?: string | number | null;
  notes?: string | null;
  isEarlyBilling?: boolean | null;
  sentAt?: string | Date | null;
  paidAt?: string | Date | null;
  createdAt?: string | Date | null;
  productSummary?: PdfProductRow[] | null;
  lineItems?: PdfLineItem[] | null;
  customer?: PdfCustomer | null;
  user?: PdfCustomer | null;
  // Legacy populated shape: userId = { name, phone, email }
  userId?: PdfCustomer | string | null;
}

export interface PdfOptions {
  detailed?: boolean;
  upiId?: string;
  upiName?: string;
  phone?: string;
  tenantId?: string;
}

// ── Brand / palette ─────────────────────────────────────────────────────────
const C = {
  greenDark: '#1a4731',
  green: '#3d7a5c',
  greenLight: '#f0f7f3',
  greenBorder: '#b8d9c7',
  greenText: '#7dbf9a',
  greenSubtle: '#b2d8c4',
  greenTitleBg: '#f0f7f3',
  greenTitleText: '#1a4731',
  greenAccent: '#3d7a5c',
  credit: '#1e6642',
  settled: '#1a5c38',
  debit: '#b91c1c',
  due: '#9a1c1c',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e8ede9',
  borderMid: '#c4dfd0',
  white: '#ffffff',
  rowAlt: '#f8fbf9',
  bgAlt: '#f1f5f9',
  surfaceMuted: '#f4fbf7',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'DRAFT',
  sent: 'SENT',
  paid: 'PAID',
  partially_paid: 'PARTIAL',
  overdue: 'OVERDUE',
  cancelled: 'CANCELLED',
  void: 'VOID',
};
const STATUS_BG: Record<string, string> = {
  draft: '#64748b',
  sent: '#2563eb',
  paid: '#059669',
  partially_paid: '#d97706',
  overdue: '#dc2626',
  cancelled: '#94a3b8',
  void: '#94a3b8',
};

// Helvetica (built-in) lacks the rupee glyph — use "Rs." as print-safe fallback.
const fmtNum = (n: string | number | null | undefined): string =>
  Math.abs(Number(n ?? 0)).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmt = (n: string | number | null | undefined): string => `Rs.${fmtNum(n)}`;
const fmtC = (n: string | number | null | undefined): string => `(Rs.${fmtNum(n)})`;

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '--';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? '--'
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function monthLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// ── Normalized render model ─────────────────────────────────────────────────
interface NormLine {
  date: string | Date | null;
  description: string;
  productName: string | null;
  variantLabel: string | null;
  quantity: string | number | null;
  unit: string | null;
  amount: number;
  entryType: string;
}

interface NormProduct {
  productName: string;
  variantLabel: string;
  unit: string;
  totalQuantity: number;
  avgRate: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  rateBreakdown: Array<{ rate: number; quantity: number; amount: number }>;
}

interface NormInvoice {
  invoiceNumber: string;
  status: string;
  month: number;
  year: number;
  previousBalance: number;
  totalCharges: number;
  orderCredits: number;
  totalPayments: number;
  totalAdjustments: number;
  netAmountDue: number;
  notes: string | null;
  isEarlyBilling: boolean;
  sentAt: string | Date | null;
  paidAt: string | Date | null;
  createdAt: string | Date | null;
  customer: { name: string; phone: string; email: string | null };
  products: NormProduct[];
  lines: NormLine[];
}

function normalize(
  inv: PdfInvoice,
  fallbackLines: PdfLineItem[] = [],
  fallbackCustomer: PdfCustomer | null = null,
  fallbackProducts: PdfProductRow[] = [],
): NormInvoice {
  const rawCustomer =
    inv.customer ??
    inv.user ??
    (inv.userId && typeof inv.userId === 'object' ? inv.userId : null) ??
    fallbackCustomer ??
    {};
  const rawLines = inv.lineItems ?? fallbackLines;
  const rawProducts = inv.productSummary ?? fallbackProducts;
  return {
    invoiceNumber: inv.invoiceNumber,
    status: inv.status ?? 'draft',
    month: inv.billingMonth ?? inv.billingPeriod?.month ?? 1,
    year: inv.billingYear ?? inv.billingPeriod?.year ?? new Date().getFullYear(),
    previousBalance: Number(inv.previousBalance ?? 0),
    totalCharges: Number(inv.totalCharges ?? 0),
    orderCredits: Number(inv.orderCredits ?? 0),
    totalPayments: Number(inv.totalPayments ?? 0),
    totalAdjustments: Number(inv.totalAdjustments ?? 0),
    netAmountDue: Number(inv.netAmountDue ?? 0),
    notes: inv.notes ?? null,
    isEarlyBilling: inv.isEarlyBilling ?? false,
    sentAt: inv.sentAt ?? null,
    paidAt: inv.paidAt ?? null,
    createdAt: inv.createdAt ?? null,
    customer: {
      name: rawCustomer.name ?? '--',
      phone: rawCustomer.phone ?? '--',
      email: rawCustomer.email ?? null,
    },
    products: rawProducts.map((p) => ({
      productName: p.productName ?? 'Product',
      variantLabel: p.variantLabel ?? '',
      unit: p.unit ?? '',
      totalQuantity: Number(p.totalQuantity ?? 0),
      avgRate: Number(p.avgRate ?? 0),
      totalAmount: Number(p.totalAmount ?? 0),
      paidAmount: Number(p.paidAmount ?? 0),
      outstandingAmount: Number(p.outstandingAmount ?? 0),
      rateBreakdown: p.rateBreakdown ?? [],
    })),
    lines: rawLines.map((l) => ({
      date: l.date ?? l.entryDate ?? null,
      description: l.description ?? '--',
      productName: l.productName ?? null,
      variantLabel: l.variantLabel ?? null,
      quantity: l.quantity ?? null,
      unit: l.unit ?? null,
      amount: Math.abs(Number(l.amount ?? 0)),
      entryType: l.entryType ?? 'debit',
    })),
  };
}

// ── Loader for invoice-id input ─────────────────────────────────────────────
async function loadForPdf(invoiceId: string, tenantId: string | undefined, dbOrTx: DBOrTx = db) {
  const conds =
    tenantId !== undefined
      ? and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId))
      : eq(invoices.id, invoiceId);
  const invRows = await (dbOrTx as typeof db).select().from(invoices).where(conds).limit(1);
  const inv = invRows[0];
  if (!inv) throw new Error('Invoice not found');
  const [lines, summary, userRows, tenantRows] = await Promise.all([
    (dbOrTx as typeof db).select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, inv.id)),
    (dbOrTx as typeof db).select().from(invoiceProductSummary).where(eq(invoiceProductSummary.invoiceId, inv.id)),
    (dbOrTx as typeof db)
      .select({ name: users.name, phone: users.phone, email: users.email })
      .from(users)
      .where(eq(users.id, inv.userId))
      .limit(1),
    (dbOrTx as typeof db).select().from(tenants).where(eq(tenants.id, inv.tenantId)).limit(1),
  ]);
  return { inv, lines, summary, user: userRows[0] ?? null, tenant: tenantRows[0] ?? null };
}

function toPdfInvoice(
  inv: typeof invoices.$inferSelect,
  lines: Array<typeof invoiceLineItems.$inferSelect>,
  summary: Array<typeof invoiceProductSummary.$inferSelect>,
  user: PdfCustomer | null,
): PdfInvoice {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    billingMonth: inv.billingMonth,
    billingYear: inv.billingYear,
    previousBalance: inv.previousBalance,
    totalCharges: inv.totalCharges,
    orderCredits: inv.orderCredits,
    totalPayments: inv.totalPayments,
    totalAdjustments: inv.totalAdjustments,
    netAmountDue: inv.netAmountDue,
    notes: inv.notes,
    isEarlyBilling: inv.isEarlyBilling,
    sentAt: inv.sentAt,
    paidAt: inv.paidAt,
    createdAt: inv.createdAt,
    productSummary: summary.map((s) => ({
      productId: s.productId,
      productName: s.productName,
      variantLabel: s.variantLabel,
      unit: s.unit,
      totalQuantity: s.totalQuantity,
      avgRate: s.avgRate,
      totalAmount: s.totalAmount,
      paidAmount: s.paidAmount,
      outstandingAmount: s.outstandingAmount,
    })),
    lineItems: lines.map((l) => ({
      entryDate: l.entryDate,
      description: l.description,
      productName: l.productName,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      unit: l.unit,
      amount: l.amount,
      entryType: l.entryType,
    })),
    customer: user,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render a PDF buffer from explicit parts.
 * `invoice` may already embed lineItems/productSummary/customer; the separate
 * args act as fallbacks (and productSummary is loaded from DB when missing
 * but the invoice id is known).
 */
export async function generateInvoicePDFBuffer(
  invoice: PdfInvoice,
  lineItems: PdfLineItem[] = [],
  tenant: PdfTenant | null = null,
  user: PdfCustomer | null = null,
  opts: PdfOptions = {},
): Promise<Buffer> {
  let products: PdfProductRow[] = invoice.productSummary ?? [];
  if (products.length === 0 && invoice.id) {
    try {
      const rows = await db
        .select()
        .from(invoiceProductSummary)
        .where(eq(invoiceProductSummary.invoiceId, invoice.id));
      products = rows.map((s) => ({
        productId: s.productId,
        productName: s.productName,
        variantLabel: s.variantLabel,
        unit: s.unit,
        totalQuantity: s.totalQuantity,
        avgRate: s.avgRate,
        totalAmount: s.totalAmount,
        paidAmount: s.paidAmount,
        outstandingAmount: s.outstandingAmount,
      }));
    } catch {
      products = [];
    }
  }
  const norm = normalize({ ...invoice, productSummary: products }, lineItems, user);
  return renderPdf(norm, tenant, opts);
}

/**
 * Generate an invoice PDF from either an invoice id or invoice data.
 * When given an id, `opts.tenantId` scopes the lookup.
 */
export async function generateInvoicePDF(
  invoiceOrId: string | PdfInvoice,
  opts: PdfOptions = {},
): Promise<Buffer> {
  if (typeof invoiceOrId === 'string') {
    const { inv, lines, summary, user, tenant } = await loadForPdf(invoiceOrId, opts.tenantId);
    return renderPdf(
      normalize(toPdfInvoice(inv, lines, summary, user)),
      tenant
        ? {
            name: tenant.name,
            brandPhone: tenant.brandPhone,
            upiId: tenant.upiId,
            upiName: tenant.upiName,
            brandLogoUrl: tenant.brandLogoUrl,
          }
        : null,
      opts,
    );
  }
  let tenantBrand: PdfTenant | null = null;
  if (opts.tenantId) {
    try {
      const rows = await db.select().from(tenants).where(eq(tenants.id, opts.tenantId)).limit(1);
      const t = rows[0];
      if (t) {
        tenantBrand = {
          name: t.name,
          brandPhone: t.brandPhone,
          upiId: t.upiId,
          upiName: t.upiName,
          brandLogoUrl: t.brandLogoUrl,
        };
      }
    } catch {
      tenantBrand = null;
    }
  }
  return generateInvoicePDFBuffer(invoiceOrId, invoiceOrId.lineItems ?? [], tenantBrand, null, opts);
}

// ── Renderer ────────────────────────────────────────────────────────────────
async function renderPdf(norm: NormInvoice, tenant: PdfTenant | null, opts: PdfOptions): Promise<Buffer> {
  const brandName = (tenant?.name ?? 'FARMILKY').toUpperCase();
  const brandPhone = opts.phone ?? tenant?.brandPhone ?? process.env.BRAND_PHONE ?? '9244237975';
  const upiId = (opts.upiId ?? tenant?.upiId ?? process.env.UPI_ID ?? '').trim();
  const upiName = (opts.upiName ?? tenant?.upiName ?? process.env.UPI_NAME ?? 'Farmilky').trim();
  const detailed = opts.detailed ?? false;

  let upiUri: string | null = null;
  let tapLink: string | null = null;
  if (upiId && norm.netAmountDue > 0) {
    const params = new URLSearchParams({
      pa: upiId,
      pn: upiName,
      am: norm.netAmountDue.toFixed(2),
      cu: 'INR',
      tn: `Farmilky Invoice ${norm.invoiceNumber}`,
    });
    upiUri = `upi://pay?${params.toString()}`;
    const backendUrl = (process.env.BACKEND_URL ?? '').replace(/\/$/, '');
    tapLink = backendUrl ? `${backendUrl}/pay/upi?${params.toString()}` : upiUri;
  }

  let qrBuffer: Buffer | null = null;
  if (upiUri) {
    try {
      qrBuffer = await QRCode.toBuffer(upiUri, {
        type: 'png',
        width: 200,
        margin: 1,
        color: { dark: '#1a4731', light: '#ffffff' },
      });
    } catch {
      qrBuffer = null;
    }
  }

  return new Promise<Buffer>((resolve, reject) => {
    const M = 30;
    const doc = new PDFDocument({
      margins: { top: M, left: M, right: M, bottom: 0 },
      size: 'A4',
      autoFirstPage: true,
      info: {
        Title: `Invoice ${norm.invoiceNumber}`,
        Author: 'Farmilky',
        Subject: `Billing period ${norm.month}/${norm.year}`,
      },
    });

    const PW = doc.page.width;
    const PH = doc.page.height;
    const W = PW - M * 2;

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const FOOT_H = 26;
    const SAFE_BOTTOM = PH - FOOT_H - 6;
    let y = 0;

    function newPage(): void {
      doc.addPage();
      y = M;
    }
    function addPageIfNeeded(needed: number): boolean {
      if (y + needed > SAFE_BOTTOM) {
        newPage();
        return true;
      }
      return false;
    }
    function rule(x: number, yy: number, w: number, color: string = C.border, lw = 0.5): void {
      doc.save().moveTo(x, yy).lineTo(x + w, yy).strokeColor(color).lineWidth(lw).stroke().restore();
    }
    function titleBar(mm: number, ww: number, yy: number, label: string): number {
      const H = 20;
      doc.save().roundedRect(mm, yy, ww, H, 2).fill(C.greenTitleBg).restore();
      doc.save().rect(mm, yy, 3, H).fill(C.greenAccent).restore();
      doc.fillColor(C.greenTitleText).font('Helvetica-Bold').fontSize(7.4)
        .text(label, mm + 10, yy + 6, { width: ww - 18, lineBreak: false });
      return yy + H;
    }
    function measureHeight(text: string, width: number, fontName = 'Helvetica', fontSize = 7.5): number {
      if (!text) return fontSize + 2;
      doc.font(fontName).fontSize(fontSize);
      return doc.heightOfString(String(text), { width });
    }
    function drawKV(
      x: number,
      yy: number,
      totalW: number,
      label: string,
      value: string,
      bold = false,
      labelW = 90,
      fontSize = 7.8,
    ): number {
      const gap = 6;
      const valW = totalW - labelW - gap;
      const fName = bold ? 'Helvetica-Bold' : 'Helvetica';
      const hVal = measureHeight(value, valW, fName, fontSize);
      const rowH = Math.max(hVal, fontSize + 2);
      doc.fillColor(C.muted).font('Helvetica').fontSize(fontSize)
        .text(label + ':', x, yy + 1, { width: labelW, lineBreak: false });
      doc.fillColor(C.text).font(fName).fontSize(fontSize)
        .text(value, x + labelW + gap, yy + 1, { width: valW });
      return rowH + 6;
    }
    function drawHeart(cx: number, cy: number, r: number, color: string): void {
      doc.save().fillColor(color)
        .moveTo(cx, cy + r)
        .bezierCurveTo(cx - r * 0.35, cy + r * 0.55, cx - r, cy + r * 0.15, cx - r, cy - r * 0.15)
        .bezierCurveTo(cx - r, cy - r * 0.65, cx - r * 0.35, cy - r, cx, cy - r * 0.55)
        .bezierCurveTo(cx + r * 0.35, cy - r, cx + r, cy - r * 0.65, cx + r, cy - r * 0.15)
        .bezierCurveTo(cx + r, cy + r * 0.15, cx + r * 0.35, cy + r * 0.55, cx, cy + r)
        .closePath().fill().restore();
    }
    function drawFooter(): void {
      const fy = PH - FOOT_H;
      const mid = PW / 2;
      doc.save().rect(0, fy, PW, FOOT_H).fill(C.greenDark).restore();
      doc.fillColor(C.greenSubtle).font('Helvetica-Bold').fontSize(8)
        .text('Pure Milk, Pure Promise', M, fy + 9, { width: W, align: 'center', lineBreak: false });
      const heartY = fy + FOOT_H / 2 - 1;
      drawHeart(mid - 52, heartY, 4.5, C.greenSubtle);
      drawHeart(mid + 52, heartY, 4.5, C.greenSubtle);
    }

    // ── Header band ──
    const HDR_H = 76;
    doc.save().rect(0, 0, PW, HDR_H).fill(C.greenDark).restore();
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(24)
      .text(brandName, M, 13, { width: W * 0.52, lineBreak: false });
    doc.fillColor(C.greenText).font('Helvetica').fontSize(7.6)
      .text('Fresh & Pure Milk Delivered Daily', M, 43, { width: W * 0.55, lineBreak: false });
    doc.fillColor(C.greenSubtle).font('Helvetica-Oblique').fontSize(7.2)
      .text('Aapka bharosa, hamari zimmedari.', M, 54.5, { width: W * 0.55, lineBreak: false });

    const RX = M + W * 0.58;
    const RW = W * 0.42;
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
      .text('INVOICE', RX, 13, { width: RW, align: 'right', lineBreak: false });
    doc.fillColor(C.greenText).font('Helvetica').fontSize(7.6)
      .text(norm.invoiceNumber, RX, 34, { width: RW, align: 'right', lineBreak: false });

    const sk = norm.status || 'draft';
    const sW = 72;
    const sH = 16;
    const sX = M + W - sW;
    const sY = 52;
    doc.save().roundedRect(sX, sY, sW, sH, 3).fill(STATUS_BG[sk] || C.green).restore();
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(6.8)
      .text(STATUS_LABELS[sk] || sk.toUpperCase(), sX, sY + 4.8, { width: sW, align: 'center', lineBreak: false });

    if (norm.status === 'paid') {
      doc.save();
      doc.rotate(-45, { origin: [PW / 2, PH / 2] });
      doc.fillColor('#16a34a').fillOpacity(0.055).font('Helvetica-Bold').fontSize(148)
        .text('PAID', 0, PH / 2 - 74, { width: PW, align: 'center', lineBreak: false });
      doc.restore();
    }

    y = HDR_H + 10;

    // ── Customer | Meta boxes ──
    const custRows: Array<[string, string, boolean]> = [
      ['Customer Name', norm.customer.name, true],
      ['Mobile No.', norm.customer.phone, false],
      ...(norm.customer.email ? [['Email', norm.customer.email, false] as [string, string, boolean]] : []),
    ];
    const metaRows: Array<[string, string, boolean]> = [
      ['Bill No.', norm.invoiceNumber, true],
      ['Billing Period', monthLabel(norm.month, norm.year), false],
      ['Bill Date', fmtDate(norm.createdAt), false],
      ...(norm.sentAt ? [['Sent On', fmtDate(norm.sentAt), false] as [string, string, boolean]] : []),
      ...(norm.paidAt ? [['Paid On', fmtDate(norm.paidAt), false] as [string, string, boolean]] : []),
      ...(norm.isEarlyBilling ? [['Type', 'Early Billing', false] as [string, string, boolean]] : []),
    ];

    const BOX_HDR_H = 24;
    const BOX_PAD_X = 10;
    const BOX_PAD_T = 12;
    const BOX_PAD_B = 12;
    const BOX_GAP = 10;
    const COL_W = (W - BOX_GAP) / 2;
    const LX = M;
    const RX2 = M + COL_W + BOX_GAP;
    const innerW = COL_W - BOX_PAD_X * 2;

    function sumRowsH(rows: Array<[string, string, boolean]>): number {
      let h = 0;
      rows.forEach(([, val, bld]) => {
        const vW = innerW - 90 - 6;
        h += Math.max(measureHeight(String(val ?? '--'), vW, bld ? 'Helvetica-Bold' : 'Helvetica', 7.8), 9.8) + 6;
      });
      return h;
    }
    const INFO_H = Math.max(BOX_HDR_H + BOX_PAD_T + sumRowsH(custRows) + BOX_PAD_B,
      BOX_HDR_H + BOX_PAD_T + sumRowsH(metaRows) + BOX_PAD_B, 104);
    addPageIfNeeded(INFO_H + 8);

    doc.save().roundedRect(LX, y, COL_W, INFO_H, 3).strokeColor(C.border).lineWidth(0.6).stroke().restore();
    doc.save().roundedRect(LX, y, COL_W, BOX_HDR_H, 3).fill(C.greenAccent);
    doc.rect(LX, y + BOX_HDR_H - 3, COL_W, 3).fill(C.greenAccent);
    doc.restore();
    rule(LX, y + BOX_HDR_H, COL_W, C.greenBorder, 0.5);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.2)
      .text('CUSTOMER DETAILS', LX + 7, y + 7.8, { width: COL_W - 14, lineBreak: false });
    let liy = y + BOX_HDR_H + BOX_PAD_T;
    custRows.forEach(([lbl, val, bld]) => {
      liy += drawKV(LX + BOX_PAD_X, liy, innerW, lbl, val, bld);
    });

    doc.save().roundedRect(RX2, y, COL_W, INFO_H, 3).strokeColor(C.border).lineWidth(0.6).stroke().restore();
    let riy = y + BOX_HDR_H + BOX_PAD_T;
    metaRows.forEach(([lbl, val, bld]) => {
      riy += drawKV(RX2 + BOX_PAD_X, riy, innerW, lbl, val, bld);
    });

    y += INFO_H + 10;
    rule(M, y - 1, W, C.border, 0.4);

    // ── Invoice summary ──
    addPageIfNeeded(110);
    y = titleBar(M, W, y, 'INVOICE SUMMARY');
    y += 10;

    const SUM_LX = M + 12;
    const SUM_LW = W * 0.52;
    const SUM_VW = W * 0.35;
    const SUM_VX_START = M + W - 12 - SUM_VW;

    function drawSummaryRow(label: string, value: string, color: string = C.text, bold = false): void {
      addPageIfNeeded(16);
      const sz = bold ? 8.8 : 8;
      doc.fillColor(C.muted).font('Helvetica').fontSize(8)
        .text(label, SUM_LX, y, { width: SUM_LW, lineBreak: false });
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz)
        .text(value, SUM_VX_START, y, { width: SUM_VW, align: 'right', lineBreak: false });
      y += sz + 5;
    }

    if (norm.previousBalance !== 0) {
      drawSummaryRow(
        'Previous Balance B/F',
        norm.previousBalance > 0 ? fmt(norm.previousBalance) : fmtC(norm.previousBalance),
        norm.previousBalance > 0 ? C.debit : C.credit,
        true,
      );
    }
    drawSummaryRow('Total Charges', fmt(norm.totalCharges));
    if (norm.orderCredits > 0) drawSummaryRow('Order Credits', fmtC(norm.orderCredits), C.credit);
    drawSummaryRow('Payments Received', fmtC(norm.totalPayments), C.credit);
    if (norm.totalAdjustments !== 0) {
      drawSummaryRow(
        'Adjustments',
        norm.totalAdjustments < 0 ? fmtC(norm.totalAdjustments) : fmt(norm.totalAdjustments),
        norm.totalAdjustments < 0 ? C.credit : C.debit,
      );
    }

    y += 3;
    rule(SUM_LX, y, W - 24, C.borderMid, 0.9);
    y += 8;
    addPageIfNeeded(22);
    const netColor = norm.netAmountDue <= 0 ? C.settled : C.due;
    const netValue = norm.netAmountDue < 0 ? fmtC(norm.netAmountDue) : fmt(norm.netAmountDue);
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(9)
      .text('Net Amount Due', SUM_LX, y, { width: SUM_LW, lineBreak: false });
    doc.fillColor(netColor).font('Helvetica-Bold').fontSize(11.5)
      .text(netValue, SUM_VX_START, y - 1.5, { width: SUM_VW, align: 'right', lineBreak: false });
    y += 16;
    if (norm.netAmountDue <= 0) {
      addPageIfNeeded(13);
      doc.fillColor(C.settled).font('Helvetica-Bold').fontSize(7.2)
        .text('Account fully settled', SUM_LX, y, { width: W - 24, lineBreak: false });
      y += 12;
    }
    y += 8;
    rule(M, y - 1, W, C.border, 0.4);

    // ── Product summary ──
    if (norm.products.length > 0) {
      if (y + 130 > SAFE_BOTTOM) newPage();
      y = titleBar(M, W, y, 'PRODUCT / MILK SUMMARY');
      const pCols = [
        { label: '#', x: M, w: 22, align: 'left' as const },
        { label: 'PRODUCT', x: M + 22, w: 136, align: 'left' as const },
        { label: 'TOTAL QTY', x: M + 158, w: 58, align: 'right' as const },
        { label: 'RATE', x: M + 216, w: 68, align: 'right' as const },
        { label: 'AMOUNT', x: M + 284, w: 74, align: 'right' as const },
        { label: 'PAID', x: M + 358, w: 68, align: 'right' as const },
        { label: 'OUTSTANDING', x: M + 426, w: W - 426, align: 'right' as const },
      ];
      const drawProdHeader = (yy: number): number => {
        doc.save().rect(M, yy, W, 19).fill(C.greenTitleBg).restore();
        doc.save().rect(M, yy + 19, W, 1).fill(C.borderMid).restore();
        pCols.forEach((col) => {
          doc.fillColor(C.greenTitleText).font('Helvetica-Bold').fontSize(6.4)
            .text(col.label, col.x + 2, yy + 6, { width: col.w - 4, align: col.align, lineBreak: false });
        });
        return yy + 19;
      };
      y = drawProdHeader(y);
      let totAmt = 0;
      let totPaid = 0;
      let totOut = 0;
      for (let idx = 0; idx < norm.products.length; idx++) {
        const p = norm.products[idx]!;
        const label = p.productName + (p.variantLabel ? ` (${p.variantLabel})` : '');
        const nameH = measureHeight(label, pCols[1].w - 4, 'Helvetica', 7.6);
        const RH = Math.max(22, nameH + 10);
        const reserve = idx === norm.products.length - 1 ? 26 : 0;
        if (y + RH + reserve > SAFE_BOTTOM) {
          newPage();
          y = drawProdHeader(y);
        }
        if (idx % 2 === 1) doc.save().rect(M, y, W, RH).fill(C.rowAlt).restore();
        const cyName = y + 6;
        doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.6)
          .text(String(idx + 1), pCols[0].x + 2, cyName, { width: pCols[0].w - 4, lineBreak: false });
        doc.fillColor(C.text).font('Helvetica').fontSize(7.6)
          .text(label, pCols[1].x + 2, cyName, { width: pCols[1].w - 4 });
        const midY = y + RH / 2 - 4;
        doc.fillColor(C.muted).font('Helvetica').fontSize(7.6)
          .text(`${p.totalQuantity} ${p.unit}`, pCols[2].x, midY, { width: pCols[2].w - 4, align: 'right', lineBreak: false })
          .text(`Rs.${p.avgRate.toFixed(2)}/${p.unit}`, pCols[3].x, midY, { width: pCols[3].w - 4, align: 'right', lineBreak: false });
        doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.6)
          .text(fmt(p.totalAmount), pCols[4].x, midY, { width: pCols[4].w - 4, align: 'right', lineBreak: false });
        doc.fillColor(C.credit).font('Helvetica').fontSize(7.6)
          .text(fmt(p.paidAmount), pCols[5].x, midY, { width: pCols[5].w - 4, align: 'right', lineBreak: false });
        doc.fillColor(p.outstandingAmount > 0 ? C.debit : C.credit).font('Helvetica-Bold').fontSize(7.6)
          .text(fmt(p.outstandingAmount), pCols[6].x, midY, { width: pCols[6].w - 4, align: 'right', lineBreak: false });
        totAmt += p.totalAmount;
        totPaid += p.paidAmount;
        totOut += p.outstandingAmount;
        rule(M, y + RH, W, C.border, 0.25);
        y += RH;
      }
      if (y + 22 > SAFE_BOTTOM) newPage();
      doc.save().rect(M, y, W, 22).fill(C.greenLight).restore();
      rule(M, y, W, C.greenBorder, 1.2);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.8)
        .text('TOTAL', pCols[1].x + 2, y + 7, { width: 80, lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.8)
        .text(fmt(totAmt), pCols[4].x, y + 7, { width: pCols[4].w - 4, align: 'right', lineBreak: false });
      doc.fillColor(C.credit).font('Helvetica-Bold').fontSize(7.8)
        .text(fmt(totPaid), pCols[5].x, y + 7, { width: pCols[5].w - 4, align: 'right', lineBreak: false });
      doc.fillColor(totOut > 0 ? C.debit : C.credit).font('Helvetica-Bold').fontSize(7.8)
        .text(fmt(totOut), pCols[6].x, y + 7, { width: pCols[6].w - 4, align: 'right', lineBreak: false });
      y += 22 + 10;
      rule(M, y - 1, W, C.border, 0.4);
    }

    // ── Detailed ledger ──
    if (detailed && norm.lines.length > 0) {
      const dCols = [
        { label: 'DATE', x: M, w: 60, align: 'left' as const },
        { label: 'DESCRIPTION', x: M + 60, w: 260, align: 'left' as const },
        { label: 'QTY', x: M + 320, w: 68, align: 'right' as const },
        { label: 'AMOUNT', x: M + 388, w: W - 388, align: 'right' as const },
      ];
      const drawLedgerHeader = (yy: number): number => {
        doc.save().rect(M, yy, W, 18).fill(C.bgAlt).restore();
        rule(M, yy, W, C.borderMid, 0.5);
        dCols.forEach((col) => {
          doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.4)
            .text(col.label, col.x + 3, yy + 5.5, { width: col.w - 6, align: col.align, lineBreak: false });
        });
        return yy + 18;
      };
      if (y + 60 > SAFE_BOTTOM) newPage();
      y = titleBar(M, W, y, `TRANSACTION LOG  (${norm.lines.length} entries)`);
      y = drawLedgerHeader(y);
      for (let i = 0; i < norm.lines.length; i++) {
        const item = norm.lines[i]!;
        const byline = item.productName
          ? item.variantLabel ? `${item.productName} (${item.variantLabel})` : item.productName
          : null;
        const descW = dCols[1].w - 6;
        const mainH = measureHeight(item.description, descW, 'Helvetica', 7.2);
        const byH = byline ? measureHeight(byline, descW, 'Helvetica', 6.2) + 2 : 0;
        const RH = Math.max(20, mainH + byH + 8);
        if (y + RH > SAFE_BOTTOM) {
          newPage();
          y = drawLedgerHeader(y);
        }
        if (i % 2 === 1) doc.save().rect(M, y, W, RH).fill(C.rowAlt).restore();
        rule(M, y, W, C.border, 0.25);
        const cy = y + 5;
        doc.fillColor(C.text).font('Helvetica').fontSize(7.2)
          .text(fmtDate(item.date), dCols[0].x + 3, cy, { width: dCols[0].w - 6, lineBreak: false });
        doc.fillColor(C.text).font('Helvetica').fontSize(7.2)
          .text(item.description, dCols[1].x + 3, cy, { width: descW, lineBreak: false });
        if (byline) {
          doc.fillColor(C.muted).font('Helvetica').fontSize(6.2)
            .text(byline, dCols[1].x + 3, cy + mainH + 1, { width: descW, lineBreak: false });
        }
        const isCr = item.entryType === 'credit';
        const qtyStr = item.quantity != null ? `${item.quantity}${item.unit ? ' ' + item.unit : ''}` : '--';
        doc.fillColor(C.muted).font('Helvetica').fontSize(7.2)
          .text(qtyStr, dCols[2].x, cy, { width: dCols[2].w - 3, align: 'right', lineBreak: false });
        doc.fillColor(isCr ? C.credit : C.debit).font('Helvetica-Bold').fontSize(7.2)
          .text(`${isCr ? '+' : '-'}${fmt(item.amount)}`, dCols[3].x, cy,
            { width: dCols[3].w - 3, align: 'right', lineBreak: false });
        y += RH;
      }
      rule(M, y, W, C.border, 0.25);
      y += 10;
      rule(M, y - 1, W, C.border, 0.4);
    }

    // ── Notes ──
    if (norm.notes) {
      const noteH = measureHeight(norm.notes, W - 24, 'Helvetica-Oblique', 7.4);
      addPageIfNeeded(noteH + 18);
      y += 4;
      doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(7.4)
        .text(norm.notes, M + 12, y, { width: W - 24 });
      y += noteH + 10;
      rule(M, y - 1, W, C.border, 0.4);
    }

    // ── Payment options / thank-you ──
    if (norm.status === 'paid') {
      addPageIfNeeded(108);
      y = titleBar(M, W, y, 'PAYMENT STATUS');
      y += 10;
      const tyH = 84;
      doc.save().roundedRect(M, y, W, tyH, 5).fill(C.surfaceMuted).restore();
      doc.save().roundedRect(M, y, W, tyH, 5)
        .dash(5, { space: 4 }).strokeColor(C.greenBorder).lineWidth(1).stroke().undash().restore();
      drawHeart(M + W / 2, y + 20, 9, C.greenAccent);
      doc.fillColor(C.greenDark).font('Helvetica-Bold').fontSize(14)
        .text('Thank You!', M, y + 34, { width: W, align: 'center', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica').fontSize(8.5)
        .text('This invoice has been fully settled.', M, y + 52, { width: W, align: 'center', lineBreak: false });
      const dateLine = norm.paidAt ? `Paid on ${fmtDate(norm.paidAt)}  |  Farmilky Team` : 'Farmilky Team';
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.4)
        .text(dateLine, M, y + 67, { width: W, align: 'center', lineBreak: false });
      y += tyH + 14;
      drawFooter();
      doc.end();
      return;
    }

    const QR_IMG = 108;
    const QR_PAD = 4;
    const QR_BOX = qrBuffer ? QR_IMG + QR_PAD * 2 : 0;
    const PAY_GAP1 = qrBuffer ? 14 : 0;
    const CONT_W = 130;
    const PAY_GAP2 = 12;
    const MID_L = M + QR_BOX + PAY_GAP1;
    const MID_W = W - QR_BOX - PAY_GAP1 - CONT_W - PAY_GAP2;
    const CONT_L = M + W - CONT_W;

    const payBodyH = upiId ? (qrBuffer ? Math.max(QR_BOX + 28, 115) : 100) : 70;
    if (y + 22 + 10 + payBodyH + 14 > SAFE_BOTTOM) newPage();
    y = titleBar(M, W, y, 'PAYMENT OPTIONS');
    y += 10;
    const payTopY = y;

    if (upiId) {
      if (qrBuffer) {
        doc.save().roundedRect(M, payTopY, QR_BOX, QR_BOX, 4)
          .strokeColor(C.greenBorder).lineWidth(1.2).stroke().restore();
        doc.image(qrBuffer, M + QR_PAD, payTopY + QR_PAD, { width: QR_IMG, height: QR_IMG, link: upiUri ?? undefined });
        doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.6)
          .text('SCAN & PAY', M, payTopY + QR_BOX + 6, { width: QR_BOX, align: 'center', lineBreak: false });
        doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8.6)
          .text(fmt(norm.netAmountDue), M, payTopY + QR_BOX + 17, { width: QR_BOX, align: 'center', lineBreak: false });
      }
      let midY = payTopY;
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.8)
        .text('Pay via UPI, Google Pay, PhonePe, or Paytm', MID_L, midY, { width: MID_W, lineBreak: false });
      midY += 15;
      const pillH = 28;
      doc.save().roundedRect(MID_L, midY, MID_W, pillH, 4).fill(C.surfaceMuted).restore();
      doc.save().roundedRect(MID_L, midY, MID_W, pillH, 4)
        .strokeColor(C.greenBorder).lineWidth(0.7).stroke().restore();
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.6)
        .text('UPI ID', MID_L + 8, midY + 9, { width: 38, lineBreak: false });
      doc.save().moveTo(MID_L + 46, midY + 5).lineTo(MID_L + 46, midY + pillH - 5)
        .strokeColor(C.greenBorder).lineWidth(0.5).stroke().restore();
      doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8.4)
        .text(upiId, MID_L + 54, midY + 8.5, { width: MID_W - 62, lineBreak: false });
      midY += pillH + 9;
      if (tapLink) {
        const tapH = 28;
        doc.save().roundedRect(MID_L + 1, midY + 2, MID_W, tapH, 6).fill('#0f2e1e').restore();
        doc.save().roundedRect(MID_L, midY, MID_W, tapH, 6).fill(C.green).restore();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
          .text('Pay via UPI  >>', MID_L, midY + 9.5, { width: MID_W, align: 'center', lineBreak: false });
        doc.link(MID_L, midY, MID_W, tapH, tapLink);
        midY += tapH + 10;
      }
      const payNote = 'After payment, share a screenshot as confirmation. Dhanyavaad!';
      doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(7)
        .text(payNote, MID_L, midY, { width: MID_W });
      midY += measureHeight(payNote, MID_W, 'Helvetica-Oblique', 7) + 4;

      if (brandPhone) {
        let contY = payTopY;
        doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.8)
          .text('CONTACT', CONT_L, contY, { width: CONT_W, lineBreak: false });
        contY += 13;
        const drawContactCard = (lbl: string, yy: number): void => {
          doc.save().roundedRect(CONT_L, yy, CONT_W, 22, 3).fill(C.surfaceMuted).restore();
          doc.save().roundedRect(CONT_L, yy, CONT_W, 22, 3)
            .strokeColor(C.border).lineWidth(0.5).stroke().restore();
          doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(6.6)
            .text(lbl, CONT_L + 7, yy + 7.5, { width: 16, lineBreak: false });
          doc.save().moveTo(CONT_L + 24, yy + 5).lineTo(CONT_L + 24, yy + 17)
            .strokeColor(C.border).lineWidth(0.5).stroke().restore();
          doc.fillColor(C.text).font('Helvetica-Bold').fontSize(7.6)
            .text(brandPhone, CONT_L + 29, yy + 7, { width: CONT_W - 32, lineBreak: false });
        };
        drawContactCard('Ph', contY);
        drawContactCard('WA', contY + 27);
      }
      const qrColH = qrBuffer ? QR_BOX + 28 : 0;
      y = Math.max(payTopY + qrColH, midY) + 12;
    } else if (brandPhone) {
      const BW = 340;
      const BH = 64;
      const BX = M + (W - BW) / 2;
      doc.save().roundedRect(BX, y, BW, BH, 6).strokeColor(C.greenBorder).lineWidth(0.8).stroke().restore();
      doc.fillColor(C.muted).font('Helvetica').fontSize(7.6)
        .text('For payments or queries, contact us:', BX + 10, y + 10, { width: BW - 20, align: 'center', lineBreak: false });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10.5)
        .text(`Ph / WhatsApp:  ${brandPhone}`, BX + 10, y + 24, { width: BW - 20, align: 'center', lineBreak: false });
      doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(7)
        .text('Share payment screenshot after transfer. Dhanyavaad!', BX + 10, y + 44,
          { width: BW - 20, align: 'center', lineBreak: false });
      y += BH + 12;
    }

    drawFooter();
    doc.end();
  });
}
