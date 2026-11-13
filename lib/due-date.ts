/**
 * Calendar-day overdue arithmetic for invoice due dates.
 *
 * A due date is a DATE, not a moment: "due 12 Nov" means payment is expected
 * by the END of 12 Nov. The API serialises it as local midnight (at UTC+8 it
 * arrives as `2026-11-11T16:00:00.000Z`), so comparing it to `new Date()`
 * directly makes an invoice due TODAY "overdue" from 00:00 on its due date —
 * a same-day cash invoice read "Over Due 1 days" minutes after it was created.
 *
 * Both sides are therefore reduced to a LOCAL calendar day before comparing.
 * An invoice is overdue only once the due day has fully passed.
 */

const startOfLocalDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days past the due date; 0 when due today or in the future. */
export function daysPastDue(dueDate: string | Date | null | undefined, now: Date = new Date()): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return 0;
  // Math.round, not floor/ceil: a DST shift makes a calendar day 23 or 25 hours.
  const diff = Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(due).getTime()) / MS_PER_DAY);
  return diff > 0 ? diff : 0;
}

/** True only once the due day has completely passed. A missing due date is never overdue. */
export const isPastDue = (dueDate: string | Date | null | undefined, now: Date = new Date()): boolean =>
  daysPastDue(dueDate, now) > 0;
