import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

/* ═══════════════════════════════════════════════════════════════
   ISO week arithmetic.
   ───────────────────────────────────────────────────────────────
   WHY THIS EXISTS

   Thirteen separate week helpers existed across Tasks, Reports, Schedule
   and Attendance, and they did not agree. ReportsPage carried two variants
   plus this comment:

     "Avoids the dayjs utc+isoWeek plugin interaction bug where calling
      .isoWeekday(1) in UTC mode can land on the wrong day (e.g. returning
      today=Tuesday instead of the previous Monday)."

   That bug is real, and the workaround was applied in exactly one of the
   thirteen call sites. Everywhere else, a user in a timezone behind UTC
   could get the wrong Monday — which silently files a report or a shift
   against the wrong week.

   The fix is structural: every function here does plain local-time day
   arithmetic and never combines `.utc()` with `.isoWeekday()`. A week is
   identified by its Monday as a bare 'YYYY-MM-DD' string, which carries
   no timezone and so cannot drift in transit.
═══════════════════════════════════════════════════════════════ */

/** A week identifier: the ISO Monday, formatted 'YYYY-MM-DD'. */
export type WeekStart = string;

/**
 * The ISO Monday of whatever week `d` falls in, in the viewer's local time.
 *
 * Deliberately uses subtraction rather than `.isoWeekday(1)` — the latter
 * misbehaves when the dayjs `utc` plugin has put the instance in UTC mode,
 * and that plugin is loaded globally by ReportsPage.
 */
export function isoMonday(d: Dayjs | string | Date = dayjs()): WeekStart {
    const local = dayjs(d);
    const dow = local.isoWeekday();           // 1 = Monday … 7 = Sunday
    return local.subtract(dow - 1, 'day').format('YYYY-MM-DD');
}

/** The Monday of the current week. */
export function currentWeek(): WeekStart {
    return isoMonday(dayjs());
}

/** Shift a week identifier by whole weeks. `addWeeks(w, -1)` → previous week. */
export function addWeeks(week: WeekStart, delta: number): WeekStart {
    return dayjs(week).add(delta, 'week').format('YYYY-MM-DD');
}

export function nextWeek(week: WeekStart = currentWeek()): WeekStart {
    return addWeeks(week, 1);
}

export function previousWeek(week: WeekStart = currentWeek()): WeekStart {
    return addWeeks(week, -1);
}

/** Inclusive [Monday 00:00, Sunday 23:59:59.999] for a week identifier. */
export function weekRange(week: WeekStart): { start: Dayjs; end: Dayjs } {
    const start = dayjs(week).startOf('day');
    return { start, end: start.add(6, 'day').endOf('day') };
}

/** Whether a date falls inside the given week. */
export function isInWeek(date: Dayjs | string | Date, week: WeekStart): boolean {
    const { start, end } = weekRange(week);
    const d = dayjs(date);
    return !d.isBefore(start) && !d.isAfter(end);
}

/** The seven days of a week, Monday first. */
export function weekDays(week: WeekStart): Dayjs[] {
    const start = dayjs(week).startOf('day');
    return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
}

/**
 * Human label for a week.
 *
 *   formatWeek('2026-08-24')              → 'Aug 24 – 30, 2026'
 *   formatWeek('2026-08-31')              → 'Aug 31 – Sep 6, 2026'
 *   formatWeek('2026-12-28')              → 'Dec 28, 2026 – Jan 3, 2027'
 */
export function formatWeek(week: WeekStart): string {
    const { start, end } = weekRange(week);
    const sameYear = start.year() === end.year();
    const sameMonth = sameYear && start.month() === end.month();

    if (sameMonth) return `${start.format('MMM D')} – ${end.format('D, YYYY')}`;
    if (sameYear)  return `${start.format('MMM D')} – ${end.format('MMM D, YYYY')}`;
    return `${start.format('MMM D, YYYY')} – ${end.format('MMM D, YYYY')}`;
}

/** Short label for tight spaces: 'Aug 24'. */
export function formatWeekShort(week: WeekStart): string {
    return dayjs(week).format('MMM D');
}

export function isCurrentWeek(week: WeekStart): boolean {
    return week === currentWeek();
}

/**
 * The week a submission form should default to.
 *
 * From Friday onward people are generally filing for the week ahead rather
 * than the one closing, so the default rolls forward. This behaviour already
 * existed in SchedulePage; centralising it keeps Reports and Schedule in step.
 */
export function defaultSubmissionWeek(rollForwardFrom: number = 5): WeekStart {
    const today = dayjs();
    return today.isoWeekday() >= rollForwardFrom ? nextWeek() : currentWeek();
}
