import { Hono } from 'hono';
import { db } from '../../shared/db/client.js';
import { tenants } from '../../shared/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { AppError } from '../../shared/middleware/errorHandler.js';
import { createLimiter } from '../../shared/middleware/rateLimiter.js';

async function resolveTenant(slug: string | undefined, tenantId: string | undefined) {
  if (tenantId) {
    const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!rows[0]) throw new AppError('Unknown tenant', 404);
    return rows[0];
  }
  if (slug) {
    const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!rows[0]) throw new AppError('Unknown tenant', 404);
    return rows[0];
  }
  throw new AppError('tenantId or tenant slug is required', 400);
}

function buildUpiUrl(tenant: typeof tenants.$inferSelect, amount?: string) {
  if (!tenant.upiId) throw new AppError('UPI is not configured for this tenant', 400);
  const params = new URLSearchParams({
    pa: tenant.upiId,
    pn: tenant.upiName ?? tenant.name,
    cu: 'INR',
  });
  if (amount) params.set('am', amount);
  return `upi://pay?${params.toString()}`;
}

function isAndroid(userAgent: string): boolean {
  return /android/i.test(userAgent);
}

function upiHtmlPage(upiUrl: string, tenantName: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pay ${tenantName}</title></head><body style="font-family:sans-serif;text-align:center;padding:48px 16px"><h1>Pay ${tenantName}</h1><p><a href="${upiUrl}" style="display:inline-block;padding:14px 28px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-size:18px">Pay with UPI</a></p><p style="color:#666">Tap the button from your phone with a UPI app installed.</p></body></html>`;
}

export const upiRoutes = new Hono();

// Public endpoint is enumerable by tenantId/slug — rate-limit it.
const upiLimiter = createLimiter(30, 15 * 60 * 1000);
upiRoutes.use('/pay/upi', upiLimiter);

upiRoutes.on(['GET', 'POST'], '/pay/upi', async (c) => {
  const url = new URL(c.req.url);
  const tenantId = url.searchParams.get('tenantId') ?? undefined;
  const slug = url.searchParams.get('slug') ?? c.req.header('x-tenant-slug') ?? undefined;
  const amount = url.searchParams.get('amount') ?? undefined;
  const tenant = await resolveTenant(slug ?? undefined, tenantId);
  const upiUrl = buildUpiUrl(tenant, amount ?? undefined);
  const ua = c.req.header('user-agent') ?? '';
  if (isAndroid(ua)) {
    const intent = `intent://pay?${upiUrl.slice('upi://'.length)}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`;
    return c.redirect(intent, 302);
  }
  return c.html(upiHtmlPage(upiUrl, tenant.name));
});
