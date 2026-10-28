import { describe, expect, it } from 'vitest';
import {
  adminCreateSubscriptionSchema,
  adminUpdateSubscriptionSchema,
  agentDeliveryOutcomeSchema,
  recordDeliveryOutcomeSchema,
  scheduleChangeSchema,
} from '../../modules/subscriptions/subscription.schema.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('subscription validation', () => {
  it('requires at least one custom delivery day on create and update', () => {
    const create = adminCreateSubscriptionSchema.safeParse({
      userId: uuid,
      productId: uuid,
      quantityPerDelivery: 1,
      deliverySlot: 'morning',
      deliverySchedule: 'custom',
    });
    const update = adminUpdateSubscriptionSchema.safeParse({
      deliverySchedule: 'custom',
    });

    expect(create.success).toBe(false);
    expect(update.success).toBe(false);
  });

  it('rejects invalid calendar dates', () => {
    const result = scheduleChangeSchema.safeParse({
      effectiveDate: '2026-02-30',
      scheduledQty: 1,
    });

    expect(result.success).toBe(false);
  });

  it('requires a valid custom schedule and positive partial quantity', () => {
    const schedule = scheduleChangeSchema.safeParse({
      effectiveDate: '2026-10-28',
      deliverySchedule: 'custom',
    });
    const outcome = recordDeliveryOutcomeSchema.safeParse({
      deliveryDate: '2026-10-27',
      status: 'partial',
      actualQuantity: 0,
    });

    expect(schedule.success).toBe(false);
    expect(outcome.success).toBe(false);
  });

  it('requires a reason for failed and skipped outcomes', () => {
    for (const status of ['failed', 'skipped'] as const) {
      const result = recordDeliveryOutcomeSchema.safeParse({
        deliveryDate: '2026-10-27',
        status,
        reason: '   ',
      });
      expect(result.success).toBe(false);
    }
  });

  it('accepts fractional quantities supported by the database precision', () => {
    const result = adminCreateSubscriptionSchema.safeParse({
      userId: uuid,
      productId: uuid,
      quantityPerDelivery: 0.25,
      deliverySlot: 'morning',
    });

    expect(result.success).toBe(true);
  });

  it('rejects quantities and prices that round to zero in the database', () => {
    const quantity = scheduleChangeSchema.safeParse({
      effectiveDate: '2026-10-28',
      scheduledQty: 0.0001,
    });
    const price = scheduleChangeSchema.safeParse({
      effectiveDate: '2026-10-28',
      scheduledPrice: 0.001,
    });

    expect(quantity.success).toBe(false);
    expect(price.success).toBe(false);
  });

  it('requires a reason for failed agent outcomes', () => {
    expect(agentDeliveryOutcomeSchema.safeParse({ status: 'failed' }).success).toBe(false);
    expect(
      agentDeliveryOutcomeSchema.safeParse({ status: 'failed', reason: 'Customer unavailable' })
        .success,
    ).toBe(true);
  });
});
