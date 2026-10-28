import { eq, sql } from 'drizzle-orm';
import { createApp } from './app.js';
import { env, validateEnv } from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';
import { db } from './shared/db/client.js';
import { connectDB } from './shared/db/client.js';
import { tenants } from './shared/db/schema/index.js';
import { initCache } from './shared/cache/index.js';
import { RedisAdapter } from './shared/cache/redisAdapter.js';
import { configureStorage } from './shared/storage/types.js';
import { createS3Storage } from './shared/storage/s3.js';
import { initJobQueue, registerRecurringJobs } from './shared/jobs/index.js';
import { registerProcessors } from './shared/jobs/registerProcessors.js';
import { generateManifestsForDate } from './modules/manifests/manifest.service.js';
import { istToday, toDateOnlyString } from './shared/utils/dateUtils.js';
import { withTransaction } from './shared/db/transaction.js';

export function initStorage(): void {
  if (!env.r2BucketName) {
    logger.warn('[r2] R2_BUCKET_NAME is not set — image uploads will fail');
    return;
  }
  try {
    configureStorage(createS3Storage());
  } catch (err) {
    logger.warn({ err }, '[r2] Storage could not be configured — image uploads will fail');
  }
}

/**
 * Full Node startup: infra init + route assembly. Not imported by the Worker
 * entry, so Node-only dependencies (Redis, BullMQ, AWS SDK) stay out of the
 * Workers bundle.
 */
export async function buildApp() {
  validateEnv();
  await connectDB();

  if (env.redisUrl) initCache(new RedisAdapter(env.redisUrl));
  else initCache();

  initStorage();

  const queue = initJobQueue();
  registerProcessors(queue);
  await registerRecurringJobs(queue).catch((err) => logger.error({ err }, 'Failed to register recurring jobs'));
  queue.startWorkers();

  // Idempotent: generate today's manifests for all active tenants.
  // Runs in the background so the server starts listening immediately.
  void (async () => {
    try {
      const activeTenants = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.isActive, true));
      const today = toDateOnlyString(istToday());
      for (const t of activeTenants) {
        for (const slot of ['morning', 'evening'] as const) {
          try {
            await withTransaction(async (tx) => {
              await tx.execute(sql`SELECT set_config('app.tenant_id', ${t.id}, true)`);
              await generateManifestsForDate(t.id, today, slot, tx, tx);
            });
          } catch (err) {
            logger.error({ err, tenantId: t.id, slot }, 'Startup manifest generation failed');
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Startup manifest generation failed');
    }
  })();

  return createApp();
}
