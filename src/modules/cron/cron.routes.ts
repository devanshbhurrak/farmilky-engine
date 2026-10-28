import { Hono } from 'hono';
import { env, isWorkersRuntime } from '../../shared/config/env.js';
import { CRON_JOBS, isCronJob, runJobNow } from '../../shared/jobs/dispatch.js';
import type { HonoEnv } from '../../shared/types/index.js';
import { fail, ok } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';

export const cronRoutes = new Hono<HonoEnv>();

// No auth/tenant middleware here — external schedulers authenticate with the
// shared CRON_SECRET bearer token. Jobs run inline: Workers have no background
// process, so the request waits for the job (use the scheduled handler for the
// platform cron instead of the HTTP endpoint on Workers).
cronRoutes.post('/trigger/:job', async (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!env.cronSecret || authHeader !== `Bearer ${env.cronSecret}`) {
    return c.json({ success: false, message: 'Unauthorized cron request' }, 401);
  }
  const job = c.req.param('job');
  if (!isCronJob(job)) {
    return fail(c, `Unknown job. Must be one of: ${CRON_JOBS.join(', ')}`, 400);
  }

  const run = runJobNow(job).catch((err) => {
    logger.error({ err, job }, 'Cron job failed');
    throw err;
  });

  if (isWorkersRuntime()) {
    try {
      c.executionCtx.waitUntil(run);
    } catch {
      await run;
    }
    return ok(c, { scheduled: job });
  }

  // Node keeps running after the response; avoid blocking the HTTP request on a
  // long fan-out over every tenant.
  void run.catch(() => undefined);
  return ok(c, { enqueued: job });
});
