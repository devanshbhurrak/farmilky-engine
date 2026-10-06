import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { validateEnv, env } from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';
import { db, connectDB } from './shared/db/client.js';
import { tenants } from './shared/db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { HonoEnv } from './shared/types/index.js';
import { initCache, getCache } from './shared/cache/index.js';
import { initJobQueue, registerRecurringJobs } from './shared/jobs/index.js';
import { registerProcessors } from './shared/jobs/registerProcessors.js';
import { onError } from './shared/middleware/errorHandler.js';
import { createLimiter } from './shared/middleware/rateLimiter.js';
import { generateManifestsForDate } from './modules/manifests/manifest.service.js';
import { istToday, toDateOnlyString } from './shared/utils/dateUtils.js';
import { withTransaction } from './shared/db/transaction.js';

import { tenantRoutes } from './modules/tenants/tenant.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { productRoutes } from './modules/products/product.routes.js';
import { cartRoutes } from './modules/cart/cart.routes.js';
import { orderRoutes } from './modules/orders/order.routes.js';
import { subscriptionRoutes } from './modules/subscriptions/subscription.routes.js';
import { manifestRoutes } from './modules/manifests/manifest.routes.js';
import { paymentRoutes } from './modules/payments/payment.routes.js';
import { expenseRoutes } from './modules/expenses/expense.routes.js';
import { invoiceRoutes } from './modules/invoices/invoice.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { areaRoutes } from './modules/areas/area.routes.js';
import { agentRoutes } from './modules/agents/agent.routes.js';
import { holidayRoutes } from './modules/holidays/holiday.routes.js';
import { complaintRoutes } from './modules/complaints/complaint.routes.js';
import { returnRoutes } from './modules/returns/return.routes.js';
import { supplierRoutes } from './modules/suppliers/supplier.routes.js';
import { milkCollectionRoutes } from './modules/milk-collections/milkCollection.routes.js';
import { supplierPaymentRoutes } from './modules/supplier-payments/supplierPayment.routes.js';
import { permissionRoutes } from './modules/permissions/permission.routes.js';
import { contactRoutes } from './modules/contact/contact.routes.js';
import { transactionRoutes } from './modules/transactions/transaction.routes.js';
import { utilsRoutes } from './modules/utils/utils.routes.js';
import { upiRoutes } from './modules/upi/upi.routes.js';
import { sseRoutes } from './modules/sse/sse.routes.js';
import { cronRoutes } from './modules/cron/cron.routes.js';

// Pure route assembly — no I/O, no side effects. Safe to import anywhere
// (tests, Cloudflare Workers) without connecting to the database.
export function createApp() {
  const app = new Hono<HonoEnv>();

  app.use('*', cors({ origin: env.allowedOrigins.length ? env.allowedOrigins : '*', credentials: true }));
  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    const start = Date.now();
    await next();
    logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start });
  });

  const authLimiter = createLimiter(100, 15 * 60 * 1000);
  const contactLimiter = createLimiter(5, 60 * 60 * 1000);
  const utilsLimiter = createLimiter(30, 15 * 60 * 1000);

  app.get('/', (c) => c.json({ name: 'Farmilky API', version: '2.0.0' }));
  app.get('/health', async (c) => {
    try {
      await db.execute(sql`SELECT 1`);
      let redis: unknown = 'n/a';
      if (env.redisUrl) {
        try {
          await getCache().exists('health-check');
          redis = 'ok';
        } catch {
          redis = 'down';
        }
      }
      return c.json({ status: 'ok', db: 'ok', redis });
    } catch {
      return c.json({ status: 'error', db: 'down' }, 503);
    }
  });

  app.route('/api/tenants', tenantRoutes);
  app.use('/api/users/*', authLimiter);
  app.route('/api/users', userRoutes);
  app.route('/api/products', productRoutes);
  app.route('/api/cart', cartRoutes);
  app.route('/api/orders', orderRoutes);
  app.route('/api/subscriptions', subscriptionRoutes);
  app.route('/api/manifests', manifestRoutes);
  app.route('/api/payments', paymentRoutes);
  app.route('/api/expenses', expenseRoutes);
  app.route('/api/invoices', invoiceRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/areas', areaRoutes);
  app.route('/api/agents', agentRoutes);
  app.route('/api/holidays', holidayRoutes);
  app.route('/api/complaints', complaintRoutes);
  app.route('/api/returns', returnRoutes);
  app.route('/api/suppliers', supplierRoutes);
  app.route('/api/milk-collections', milkCollectionRoutes);
  app.route('/api/supplier-payments', supplierPaymentRoutes);
  app.route('/api/permissions', permissionRoutes);
  app.route('/api/transactions', transactionRoutes);
  app.route('/api/cron', cronRoutes);
  app.route('/api/sse', sseRoutes);

  app.use('/api/contact/*', contactLimiter);
  app.route('/api/contact', contactRoutes);
  app.use('/api/utils/*', utilsLimiter);
  app.route('/api/utils', utilsRoutes);

  app.route('/', upiRoutes);

  app.notFound((c) => c.json({ success: false, message: 'Not found' }, 404));
  app.onError(onError);

  return app;
}

// Full Node startup: infra init + route assembly. Used by server.ts and tests.
export async function buildApp() {
  validateEnv();
  await connectDB();
  initCache();
  const queue = initJobQueue();
  registerProcessors(queue);
  await registerRecurringJobs(queue).catch((err) => logger.error({ err }, 'Failed to register recurring jobs'));
  queue.startWorkers();

  // Idempotent: generate today's manifests for all active tenants
  try {
    const activeTenants = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.isActive, true));
    const today = toDateOnlyString(istToday());
    for (const t of activeTenants) {
      try {
        await withTransaction(async (tx) => {
          await tx.execute(sql`SET LOCAL app.tenant_id = ${t.id}`);
          await generateManifestsForDate(t.id, today, 'morning', tx, tx);
        });
      } catch (err) {
        logger.error({ err, tenantId: t.id }, 'Startup morning manifest generation failed');
      }
      try {
        await withTransaction(async (tx) => {
          await tx.execute(sql`SET LOCAL app.tenant_id = ${t.id}`);
          await generateManifestsForDate(t.id, today, 'evening', tx, tx);
        });
      } catch (err) {
        logger.error({ err, tenantId: t.id }, 'Startup evening manifest generation failed');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Startup manifest generation failed');
  }

  return createApp();
}
