import { dailyDeliveryProcessor } from './processors/dailyDelivery.js';
import { endOfDayProcessor } from './processors/endOfDay.js';
import { monthlyInvoiceProcessor } from './processors/monthlyInvoice.js';

export const CRON_JOBS = ['daily-delivery', 'end-of-day', 'monthly-invoice'] as const;
export type CronJobName = (typeof CRON_JOBS)[number];

export function isCronJob(name: string): name is CronJobName {
  return (CRON_JOBS as readonly string[]).includes(name);
}

export interface CronPayload {
  tenantId?: string;
}

/**
 * Executes a scheduled job inline. Cloudflare Cron Triggers and the HTTP cron
 * endpoint both use this path; there is no long-running worker process.
 */
export async function runJobNow(job: CronJobName, payload: CronPayload = {}): Promise<void> {
  switch (job) {
    case 'daily-delivery':
      return dailyDeliveryProcessor(payload);
    case 'end-of-day':
      return endOfDayProcessor(payload);
    case 'monthly-invoice':
      return monthlyInvoiceProcessor(payload);
  }
}
