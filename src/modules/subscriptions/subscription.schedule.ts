import { addDays, normalizeDate } from '../../shared/utils/dateUtils.js';

// Pure scheduling helpers ported from backend/services/scheduler.js.
// No DB access here — these are exported for unit tests.

export interface SchedulableSubscription {
  status: string;
  deliverySchedule?: string | null;
  customDays?: string[] | null;
  nextDeliveryDate?: string | Date | null;
  startDate?: string | Date | null;
  vacationFrom?: string | Date | null;
  vacationUntil?: string | Date | null;
  skippedDates?: Array<string | Date> | null;
}

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function stepDays(schedule: string | null | undefined): number {
  if (schedule === 'alternate') return 2;
  if (schedule === 'weekly') return 7;
  return 1; // daily and unknown default
}

function skipHolidays(date: Date, step: number, holidays: Set<number> | null): Date {
  if (!holidays) return date;
  let guard = 0;
  while (holidays.has(date.getTime()) && guard < 30) {
    date.setDate(date.getDate() + step);
    guard += 1;
  }
  return date;
}

export function isSubscriptionDueOnDate(
  sub: SchedulableSubscription,
  date: Date | string = new Date(),
  holidays: Set<number> | null = null,
): boolean {
  const normalizedDate = normalizeDate(date);

  if (sub.status !== 'active') return false;

  if (holidays && holidays.has(normalizedDate.getTime())) return false;

  if (sub.vacationFrom && sub.vacationUntil) {
    const from = normalizeDate(sub.vacationFrom);
    const until = normalizeDate(sub.vacationUntil);
    if (normalizedDate >= from && normalizedDate <= until) return false;
  }

  if (sub.skippedDates && sub.skippedDates.length > 0) {
    const isSkipped = sub.skippedDates.some(
      (d) => normalizeDate(d).getTime() === normalizedDate.getTime(),
    );
    if (isSkipped) return false;
  }

  const anchor = sub.nextDeliveryDate ?? sub.startDate ?? normalizedDate;
  return normalizedDate.getTime() >= normalizeDate(anchor).getTime();
}

export function calculateNextDeliveryDate(
  sub: Pick<SchedulableSubscription, 'deliverySchedule' | 'customDays'>,
  referenceDate: Date | string = new Date(),
  holidays: Set<number> | null = null,
): Date {
  const current = normalizeDate(referenceDate);

  if (sub.deliverySchedule === 'custom') {
    const customDays = sub.customDays ?? [];
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addDays(current, offset);
      if (!customDays.includes(DAY_NAMES[candidate.getDay()] as string)) continue;
      if (holidays && holidays.has(candidate.getTime())) continue;
      return candidate;
    }
    // Fallback: next day that is not a holiday
    const fallback = addDays(current, 1);
    if (holidays) {
      let guard = 0;
      while (holidays.has(fallback.getTime()) && guard < 30) {
        fallback.setDate(fallback.getDate() + 1);
        guard += 1;
      }
    }
    return fallback;
  }

  const step = stepDays(sub.deliverySchedule);
  const next = addDays(current, step);
  return skipHolidays(next, step, holidays);
}

/**
 * Advance from `fromDate` to the next date that is actually due, skipping
 * holidays, vacation windows and skipped dates. Used whenever
 * `nextDeliveryDate` is recomputed so it never lands on a non-delivery day.
 * The probe is forced to `active` status — callers must have already decided
 * the subscription may be served.
 */
export function advanceToNextDue(
  sub: SchedulableSubscription,
  fromDate: Date | string,
  holidays: Set<number> | null = null,
): Date {
  let candidate = normalizeDate(fromDate);
  const probe: SchedulableSubscription = { ...sub, status: 'active' };
  for (let i = 0; i < 60; i += 1) {
    probe.nextDeliveryDate = candidate;
    if (isSubscriptionDueOnDate(probe, candidate, holidays)) return candidate;
    candidate = normalizeDate(
      calculateNextDeliveryDate(
        { deliverySchedule: sub.deliverySchedule, customDays: sub.customDays },
        candidate,
        holidays,
      ),
    );
  }
  return candidate;
}
