import type { JobQueueAdapter } from './types.js';
import { BullmqAdapter } from './bullmqAdapter.js';
import { PgAdapter } from './pgAdapter.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type { JobQueueAdapter, JobHandler, EnqueueOpts } from './types.js';

export let jobQueueAdapter: JobQueueAdapter;

export function initJobQueue(adapter?: JobQueueAdapter): JobQueueAdapter {
  if (adapter) {
    jobQueueAdapter = adapter;
    return jobQueueAdapter;
  }
  if (env.redisUrl) {
    jobQueueAdapter = new BullmqAdapter(env.redisUrl);
    logger.info('Jobs: BullMQ');
  } else {
    jobQueueAdapter = new PgAdapter();
    logger.warn('REDIS_URL not set — using pg job queue fallback');
  }
  return jobQueueAdapter;
}

export function getJobQueue(): JobQueueAdapter {
  if (!jobQueueAdapter) return initJobQueue();
  return jobQueueAdapter;
}

export async function registerRecurringJobs(adapter: JobQueueAdapter): Promise<void> {
  await adapter.scheduleRecurring('daily-delivery', '0 5 * * *', 'daily-delivery', {});
  await adapter.scheduleRecurring('end-of-day', '0 23 * * *', 'end-of-day', {});
  await adapter.scheduleRecurring('monthly-invoice', '0 2 1 * *', 'monthly-invoice', {});
}
