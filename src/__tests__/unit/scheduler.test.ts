import { describe, expect, it } from 'vitest';
import {
  advanceToNextDue,
  calculateNextDeliveryDate,
  isSubscriptionDueOnDate,
  type SchedulableSubscription,
} from '../../modules/subscriptions/subscription.schedule.js';
import { normalizeDate } from '../../shared/utils/dateUtils.js';

function baseSub(overrides: Partial<SchedulableSubscription> = {}): SchedulableSubscription {
  return {
    status: 'active',
    deliverySchedule: 'daily',
    customDays: [],
    nextDeliveryDate: new Date(2026, 0, 5), // 2026-01-05
    startDate: new Date(2026, 0, 1),
    vacationFrom: null,
    vacationUntil: null,
    skippedDates: [],
    ...overrides,
  };
}

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// ─── isSubscriptionDueOnDate ─────────────────────────────────────────────────

describe('isSubscriptionDueOnDate – status gates', () => {
  it('false for paused', () => {
    expect(isSubscriptionDueOnDate(baseSub({ status: 'paused' }), D(2026, 1, 5))).toBe(false);
  });

  it('false for cancelled', () => {
    expect(isSubscriptionDueOnDate(baseSub({ status: 'cancelled' }), D(2026, 1, 5))).toBe(false);
  });

  it('false for pending', () => {
    expect(isSubscriptionDueOnDate(baseSub({ status: 'pending' }), D(2026, 1, 5))).toBe(false);
  });
});

describe('isSubscriptionDueOnDate – holiday gate', () => {
  it('false on a holiday', () => {
    const holidays = new Set([normalizeDate(D(2026, 1, 5)).getTime()]);
    expect(isSubscriptionDueOnDate(baseSub(), D(2026, 1, 5), holidays)).toBe(false);
  });

  it('true the day after the holiday', () => {
    const holidays = new Set([normalizeDate(D(2026, 1, 5)).getTime()]);
    expect(isSubscriptionDueOnDate(baseSub({ nextDeliveryDate: D(2026, 1, 5) }), D(2026, 1, 6), holidays)).toBe(true);
  });
});

describe('isSubscriptionDueOnDate – vacation window', () => {
  it('false when date is inside vacation window', () => {
    const sub = baseSub({ vacationFrom: D(2026, 1, 4), vacationUntil: D(2026, 1, 10) });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 6))).toBe(false);
  });

  it('false on vacationFrom boundary (inclusive)', () => {
    const sub = baseSub({ vacationFrom: D(2026, 1, 5), vacationUntil: D(2026, 1, 10) });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5))).toBe(false);
  });

  it('false on vacationUntil boundary (inclusive)', () => {
    const sub = baseSub({ vacationFrom: D(2026, 1, 1), vacationUntil: D(2026, 1, 5) });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5))).toBe(false);
  });

  it('true the day after vacationUntil', () => {
    const sub = baseSub({ vacationFrom: D(2026, 1, 4), vacationUntil: D(2026, 1, 10) });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 11))).toBe(true);
  });

  it('true the day before vacationFrom', () => {
    const sub = baseSub({ vacationFrom: D(2026, 1, 6), vacationUntil: D(2026, 1, 10) });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5))).toBe(true);
  });
});

describe('isSubscriptionDueOnDate – skipped dates', () => {
  it('false on a skipped date', () => {
    const sub = baseSub({ skippedDates: [D(2026, 1, 5)] });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5))).toBe(false);
  });

  it('true on adjacent day even if nearby date is skipped', () => {
    const sub = baseSub({ skippedDates: [D(2026, 1, 5)] });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 6))).toBe(true);
  });

  it('only the matching date is blocked, not others', () => {
    const sub = baseSub({ skippedDates: [D(2026, 1, 7), D(2026, 1, 8)] });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5))).toBe(true);
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 7))).toBe(false);
  });
});

describe('isSubscriptionDueOnDate – next delivery date anchor', () => {
  it('false when date < nextDeliveryDate', () => {
    expect(isSubscriptionDueOnDate(baseSub(), D(2026, 1, 4))).toBe(false);
  });

  it('true on exactly nextDeliveryDate', () => {
    expect(isSubscriptionDueOnDate(baseSub(), D(2026, 1, 5))).toBe(true);
  });

  it('true on any date after nextDeliveryDate for daily', () => {
    expect(isSubscriptionDueOnDate(baseSub(), D(2026, 1, 20))).toBe(true);
  });
});

describe('isSubscriptionDueOnDate – delivery schedules', () => {
  it('alternate: due on nextDeliveryDate', () => {
    expect(isSubscriptionDueOnDate(baseSub({ deliverySchedule: 'alternate' }), D(2026, 1, 5))).toBe(true);
  });

  it('weekly: due on nextDeliveryDate', () => {
    expect(isSubscriptionDueOnDate(baseSub({ deliverySchedule: 'weekly' }), D(2026, 1, 5))).toBe(true);
  });

  it('custom Monday: true on 2026-01-05 (Monday) which is nextDeliveryDate', () => {
    const sub = baseSub({ deliverySchedule: 'custom', customDays: ['Monday'] });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5))).toBe(true);
  });

  it('custom Monday: still true on later Mondays (nextDeliveryDate passed)', () => {
    const sub = baseSub({ deliverySchedule: 'custom', customDays: ['Monday'], nextDeliveryDate: D(2026, 1, 5) });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 12))).toBe(true); // next Monday
  });
});

describe('isSubscriptionDueOnDate – combined gates', () => {
  it('skipped date inside vacation window → still false (skipped wins)', () => {
    const sub = baseSub({
      vacationFrom: D(2026, 1, 4),
      vacationUntil: D(2026, 1, 10),
      skippedDates: [D(2026, 1, 5)],
    });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5))).toBe(false);
  });

  it('holiday + vacation: both block delivery', () => {
    const holidays = new Set([normalizeDate(D(2026, 1, 5)).getTime()]);
    const sub = baseSub({ vacationFrom: D(2026, 1, 4), vacationUntil: D(2026, 1, 10) });
    expect(isSubscriptionDueOnDate(sub, D(2026, 1, 5), holidays)).toBe(false);
  });
});

// ─── calculateNextDeliveryDate ───────────────────────────────────────────────

describe('calculateNextDeliveryDate – base advancement', () => {
  it('daily: advances by 1', () => {
    const next = calculateNextDeliveryDate({ deliverySchedule: 'daily', customDays: [] }, D(2026, 1, 5));
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 6)).getTime());
  });

  it('alternate: advances by 2', () => {
    const next = calculateNextDeliveryDate({ deliverySchedule: 'alternate', customDays: [] }, D(2026, 1, 5));
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 7)).getTime());
  });

  it('weekly: advances by 7', () => {
    const next = calculateNextDeliveryDate({ deliverySchedule: 'weekly', customDays: [] }, D(2026, 1, 5));
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 12)).getTime());
  });
});

describe('calculateNextDeliveryDate – holiday skipping', () => {
  it('daily: skips a single holiday', () => {
    const holidays = new Set([normalizeDate(D(2026, 1, 6)).getTime()]);
    const next = calculateNextDeliveryDate({ deliverySchedule: 'daily', customDays: [] }, D(2026, 1, 5), holidays);
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 7)).getTime());
  });

  it('daily: skips consecutive holidays (2 in a row)', () => {
    const holidays = new Set([
      normalizeDate(D(2026, 1, 6)).getTime(),
      normalizeDate(D(2026, 1, 7)).getTime(),
    ]);
    const next = calculateNextDeliveryDate({ deliverySchedule: 'daily', customDays: [] }, D(2026, 1, 5), holidays);
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 8)).getTime());
  });

  it('daily: skips three consecutive holidays', () => {
    const holidays = new Set([
      normalizeDate(D(2026, 1, 6)).getTime(),
      normalizeDate(D(2026, 1, 7)).getTime(),
      normalizeDate(D(2026, 1, 8)).getTime(),
    ]);
    const next = calculateNextDeliveryDate({ deliverySchedule: 'daily', customDays: [] }, D(2026, 1, 5), holidays);
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 9)).getTime());
  });

  it('no holidays: returns canonical next date', () => {
    const next = calculateNextDeliveryDate({ deliverySchedule: 'daily', customDays: [] }, D(2026, 1, 5), new Set());
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 6)).getTime());
  });
});

describe('calculateNextDeliveryDate – custom schedule', () => {
  it('finds next Monday from a Tuesday', () => {
    // 2026-01-06 is Tuesday → next Monday is 2026-01-12
    const next = calculateNextDeliveryDate(
      { deliverySchedule: 'custom', customDays: ['Monday'] },
      D(2026, 1, 6),
    );
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 12)).getTime());
  });

  it('finds closest matching day from multiple custom days', () => {
    // From Monday 2026-01-05 with Mon+Wed → next occurrence is Wednesday 2026-01-07
    const next = calculateNextDeliveryDate(
      { deliverySchedule: 'custom', customDays: ['Monday', 'Wednesday'] },
      D(2026, 1, 5),
    );
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 7)).getTime());
  });

  it('skips holiday and uses fallback for custom schedule', () => {
    // Next Monday from 2026-01-06 is 2026-01-12 — which is a holiday
    const holidays = new Set([normalizeDate(D(2026, 1, 12)).getTime()]);
    const next = calculateNextDeliveryDate(
      { deliverySchedule: 'custom', customDays: ['Monday'] },
      D(2026, 1, 6),
      holidays,
    );
    // Should not land on the holiday
    expect(next.getTime()).not.toBe(normalizeDate(D(2026, 1, 12)).getTime());
  });

  it('custom with empty days uses fallback (next day)', () => {
    // No matching days found in 7-day window → fallback +1
    const next = calculateNextDeliveryDate(
      { deliverySchedule: 'custom', customDays: [] },
      D(2026, 1, 5),
    );
    expect(next.getTime()).toBe(normalizeDate(D(2026, 1, 6)).getTime());
  });
});

// ─── advanceToNextDue ────────────────────────────────────────────────────────

describe('advanceToNextDue', () => {
  it('returns fromDate itself when it is immediately due', () => {
    const sub = baseSub({ nextDeliveryDate: D(2026, 1, 5) });
    const result = advanceToNextDue(sub, D(2026, 1, 5));
    expect(result.getTime()).toBe(normalizeDate(D(2026, 1, 5)).getTime());
  });

  it('skips a holiday and lands on next valid date', () => {
    const sub = baseSub({ nextDeliveryDate: D(2026, 1, 5) });
    const holidays = new Set([normalizeDate(D(2026, 1, 5)).getTime()]);
    const result = advanceToNextDue(sub, D(2026, 1, 5), holidays);
    expect(result.getTime()).toBe(normalizeDate(D(2026, 1, 6)).getTime());
  });

  it('skips vacation window to land after it ends', () => {
    const sub = baseSub({
      nextDeliveryDate: D(2026, 1, 5),
      vacationFrom: D(2026, 1, 5),
      vacationUntil: D(2026, 1, 9),
    });
    const result = advanceToNextDue(sub, D(2026, 1, 5));
    expect(result.getTime()).toBeGreaterThanOrEqual(normalizeDate(D(2026, 1, 10)).getTime());
  });

  it('skips a skipped date and returns next valid one', () => {
    const sub = baseSub({
      nextDeliveryDate: D(2026, 1, 5),
      skippedDates: [D(2026, 1, 5)],
    });
    const result = advanceToNextDue(sub, D(2026, 1, 5));
    expect(result.getTime()).toBe(normalizeDate(D(2026, 1, 6)).getTime());
  });

  it('weekly schedule: when fromDate itself is unblocked it is returned immediately', () => {
    // advanceToNextDue returns the earliest unblocked date starting from fromDate.
    // For a weekly sub with nextDeliveryDate=Jan 12, starting at Jan 12: Jan 12 is due → returned.
    const sub = baseSub({
      deliverySchedule: 'weekly',
      nextDeliveryDate: D(2026, 1, 12),
    });
    const result = advanceToNextDue(sub, D(2026, 1, 12));
    expect(result.getDate()).toBe(12);
  });
});
