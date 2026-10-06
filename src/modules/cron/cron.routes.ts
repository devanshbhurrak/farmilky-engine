import { Hono } from 'hono';
import { env } from '../../shared/config/env.js';
import { getJobQueue } from '../../shared/jobs/index.js';
import type { HonoEnv } from '../../shared/types/index.js';
import { fail, ok } from '../../shared/utils/response.js';

const VALID_JOBS = new Set(['daily-delivery', 'end-of-day', 'monthly-invoice']);

export const cronRoutes = new Hono<HonoEnv>();

// No auth/tenant middleware here — external schedulers authenticate with the
// shared CRON_SECRET bearer token. A single fan-out job is enqueued; the
// processor fans out across tenants internally.
cronRoutes.post('/trigger/:job', async (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!env.cronSecret || authHeader !== `Bearer ${env.cronSecret}`) {
    return c.json({ success: false, message: 'Unauthorized cron request' }, 401);
  }
  const job = c.req.param('job');
  if (!VALID_JOBS.has(job)) {
    return fail(c, `Unknown job. Must be one of: ${[...VALID_JOBS].join(', ')}`, 400);
  }
  await getJobQueue().enqueue(job, {});
  return ok(c, { enqueued: job });
});
