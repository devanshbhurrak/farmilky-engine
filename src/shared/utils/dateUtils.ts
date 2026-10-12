// India-only date helpers. All business dates are computed in IST (UTC+5:30).
// No timezone library needed since the platform is India-only.
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

export function istToday(): Date {
  const now = new Date(Date.now() + IST_OFFSET_MS);
  const d = new Date(0);
  d.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  d.setUTCHours(0, 0, 0, 0);
  // Return as a local Date at midnight (date-only semantics)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Current year in IST (avoids wrong bucket at the UTC new-year boundary). */
export function istYear(): number {
  return new Date(Date.now() + IST_OFFSET_MS).getUTCFullYear();
}

export function normalizeDate(d: Date | string): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isSameDay(a: Date | string, b: Date | string): boolean {
  return normalizeDate(a).getTime() === normalizeDate(b).getTime();
}

export function isBefore(a: Date | string, b: Date | string): boolean {
  return normalizeDate(a).getTime() < normalizeDate(b).getTime();
}

export function addDays(d: Date | string, days: number): Date {
  const date = normalizeDate(d);
  date.setDate(date.getDate() + days);
  return date;
}

export function toDateOnlyString(d: Date | string): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Subtract `n` calendar months, clamping to the last valid day (date-fns subMonths equivalent). */
export function subMonths(d: Date | string, n: number): Date {
  const src = new Date(d);
  const day = src.getDate();
  const target = new Date(src.getFullYear(), src.getMonth() - n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/** Calendar-day difference ignoring time-of-day (date-fns differenceInCalendarDays equivalent). */
export function differenceInCalendarDays(a: Date | string, b: Date | string): number {
  return Math.round(
    (normalizeDate(a).getTime() - normalizeDate(b).getTime()) / 86_400_000,
  );
}
