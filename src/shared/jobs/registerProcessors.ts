import type { JobQueueAdapter } from './types.js';
import { dailyDeliveryProcessor } from './processors/dailyDelivery.js';
import { endOfDayProcessor } from './processors/endOfDay.js';
import { monthlyInvoiceProcessor } from './processors/monthlyInvoice.js';

function tenantPayload(payload: Record<string, unknown>): { tenantId?: string } {
  return {
    tenantId: typeof payload['tenantId'] === 'string' ? payload['tenantId'] : undefined,
  };
}

export function registerProcessors(adapter: JobQueueAdapter): void {
  adapter.registerProcessor('daily-delivery', (payload) =>
    dailyDeliveryProcessor(tenantPayload(payload)),
  );
  adapter.registerProcessor('end-of-day', (payload) =>
    endOfDayProcessor(tenantPayload(payload)),
  );
  adapter.registerProcessor('monthly-invoice', (payload) =>
    monthlyInvoiceProcessor(tenantPayload(payload)),
  );
}
