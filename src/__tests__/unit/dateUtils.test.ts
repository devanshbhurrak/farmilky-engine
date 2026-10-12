import { describe, expect, it } from 'vitest';
import {
  addDays,
  differenceInCalendarDays,
  isBefore,
  isSameDay,
  normalizeDate,
  round2,
  subMonths,
  toDateOnlyString,
} from '../../shared/utils/dateUtils.js';

describe('normalizeDate', () => {
  it('strips time component from a Date', () => {
    const d = new Date(2026, 0, 15, 14, 30, 59, 999);
    const norm = normalizeDate(d);
    expect(norm.getHours()).toBe(0);
    expect(norm.getMinutes()).toBe(0);
    expect(norm.getSeconds()).toBe(0);
    expect(norm.getMilliseconds()).toBe(0);
    expect(norm.getFullYear()).toBe(2026);
    expect(norm.getMonth()).toBe(0);
    expect(norm.getDate()).toBe(15);
  });

  it('parses an ISO date string', () => {
    const norm = normalizeDate('2026-03-25');
    expect(toDateOnlyString(norm)).toBe('2026-03-25');
  });

  it('two calls on the same date produce the same timestamp', () => {
    const a = normalizeDate(new Date(2026, 2, 1, 8, 0));
    const b = normalizeDate(new Date(2026, 2, 1, 22, 59));
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('isSameDay', () => {
  it('same calendar date at different times → true', () => {
    expect(isSameDay(new Date(2026, 0, 5, 9), new Date(2026, 0, 5, 23))).toBe(true);
  });

  it('adjacent dates → false', () => {
    expect(isSameDay(new Date(2026, 0, 5), new Date(2026, 0, 6))).toBe(false);
  });

  it('works with ISO strings', () => {
    expect(isSameDay('2026-06-01', '2026-06-01')).toBe(true);
    expect(isSameDay('2026-06-01', '2026-06-02')).toBe(false);
  });
});

describe('isBefore', () => {
  it('earlier date is before later date', () => {
    expect(isBefore('2026-01-01', '2026-01-02')).toBe(true);
  });

  it('same date is not before itself', () => {
    expect(isBefore('2026-01-05', '2026-01-05')).toBe(false);
  });

  it('later date is not before earlier date', () => {
    expect(isBefore('2026-01-10', '2026-01-01')).toBe(false);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    const result = addDays(new Date(2026, 0, 28), 5);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(2);
  });

  it('crosses month boundary correctly', () => {
    const result = addDays('2026-01-31', 1);
    expect(toDateOnlyString(result)).toBe('2026-02-01');
  });

  it('crosses year boundary correctly', () => {
    const result = addDays('2025-12-31', 1);
    expect(toDateOnlyString(result)).toBe('2026-01-01');
  });

  it('adding zero returns the same date', () => {
    const result = addDays('2026-03-15', 0);
    expect(toDateOnlyString(result)).toBe('2026-03-15');
  });

  it('result has time zeroed out', () => {
    const result = addDays(new Date(2026, 0, 5, 16, 30), 1);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });
});

describe('toDateOnlyString', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(toDateOnlyString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('pads month and day with leading zero', () => {
    expect(toDateOnlyString(new Date(2026, 8, 3))).toBe('2026-09-03'); // September = month 8
  });

  it('handles December correctly', () => {
    expect(toDateOnlyString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('round-trips through normalizeDate', () => {
    const str = '2026-07-04';
    expect(toDateOnlyString(normalizeDate(str))).toBe(str);
  });
});

describe('round2', () => {
  it('rounds to 2 decimal places', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1.004)).toBe(1.00);
  });

  it('handles exact values without change', () => {
    expect(round2(100)).toBe(100);
    expect(round2(33.33)).toBe(33.33);
  });

  it('handles floating point imprecision (e.g. 0.1+0.2)', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('negative values rounded correctly', () => {
    expect(round2(-1.005)).toBe(-1.00);
    expect(round2(-33.3367)).toBe(-33.34);
  });

  it('zero remains zero', () => {
    expect(round2(0)).toBe(0);
  });
});

describe('subMonths', () => {
  it('subtracts within the same year', () => {
    const d = subMonths(new Date(2026, 5, 15), 1);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(15);
  });

  it('rolls January back to December of the previous year', () => {
    const d = subMonths(new Date(2026, 0, 15), 1);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(15);
  });

  it('clamps to the last valid day (Mar 31 minus 1 month → Feb 28)', () => {
    const d = subMonths(new Date(2026, 2, 31), 1);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(28);
  });
});

describe('differenceInCalendarDays', () => {
  it('counts whole calendar days ignoring time-of-day', () => {
    expect(differenceInCalendarDays('2026-01-10', '2026-01-01')).toBe(9);
    expect(
      differenceInCalendarDays(new Date(2026, 0, 2, 23, 59), new Date(2026, 0, 1, 0, 1)),
    ).toBe(1);
  });

  it('is zero for the same day and negative when reversed', () => {
    expect(differenceInCalendarDays('2026-04-05', '2026-04-05')).toBe(0);
    expect(differenceInCalendarDays('2026-04-01', '2026-04-05')).toBe(-4);
  });
});
