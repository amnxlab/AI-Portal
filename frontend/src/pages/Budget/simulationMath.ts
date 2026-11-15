/**
 * The arithmetic behind the budget simulation, in one place.
 *
 * The engine already integrated day by day over each assignment's real dates.
 * The table beside it did not: it showed `rate x hours x 4.33` for every row,
 * a flat "average month" that takes no notice of start and end dates at all.
 * A three-day assignment was therefore displayed as a full month of salary --
 * roughly ten times its real cost -- while the chart underneath showed the
 * correct, much smaller figure.
 *
 * Both now call the functions here, so a number in the table and the same
 * number in the timeline cannot drift apart again.
 */
import dayjs, { type Dayjs } from 'dayjs';

/**
 * Weeks in an average calendar month: 365 / 12 / 7 = 4.345.
 *
 * Correct only for a period with no end -- an open-ended assignment really
 * does cost this much every month, on average. It is wrong for anything with
 * dates, which is what went wrong before.
 */
export const AVG_WEEKS_PER_MONTH = 365 / 12 / 7;

/**
 * Days in a working week: Monday to Friday, matching the schedule and report
 * tabs, which build their weeks with `isoWeekday(1)`.
 *
 * Weekly hours are divided by this and charged only on weekdays. Dividing by
 * seven instead -- charging Saturdays and Sundays -- made a Monday-to-Friday
 * booking cost 5/7 of the week it was booked for.
 */
export const WORKING_DAYS_PER_WEEK = 5;

/** Monday through Friday. dayjs: 0 is Sunday, 6 is Saturday. */
export function isWorkingDay(d: Dayjs): boolean {
    const n = d.day();
    return n >= 1 && n <= 5;
}

/**
 * Working days in [start, end) -- end exclusive.
 *
 * Counted by whole weeks plus the remainder, rather than by walking every
 * day, so a multi-year open-ended period costs a few arithmetic operations
 * instead of a thousand iterations.
 */
export function workingDaysBetween(start: Dayjs, end: Dayjs): number {
    if (!end.isAfter(start)) return 0;
    const total = end.diff(start, 'day');
    const whole = Math.floor(total / 7);
    let count = whole * WORKING_DAYS_PER_WEEK;
    let cursor = start.add(whole * 7, 'day');
    while (cursor.isBefore(end)) {
        if (isWorkingDay(cursor)) count += 1;
        cursor = cursor.add(1, 'day');
    }
    return count;
}

export interface PeriodLike {
    startDate: string | null;
    endDate: string | null;
    hourlyRate: number;
    weeklyHours: number;
    /**
     * Bill Saturdays and Sundays too.
     *
     * Off by default: the working week is Monday to Friday, as in the
     * schedule and report tabs. Turning it on spreads the weekly hours over
     * all seven days instead of five, so a seven-day span still costs exactly
     * one week -- the hours are the same, the days they land on are not.
     */
    includeWeekends?: boolean;
}

export interface PeriodWindow {
    /** First day counted. */
    start: Dayjs;
    /** Exclusive upper bound: the first day NOT counted. */
    end: Dayjs;
    /** Whole calendar days in the window; 0 when the period is outside the sim. */
    days: number;
    /** Monday-to-Friday days in the window: what actually gets billed. */
    workingDays: number;
    /** True when the period has no end date and runs to the simulation's end. */
    openEnded: boolean;
}

/**
 * Which days of a period actually fall inside the simulation.
 *
 * `endDate` is the last working day as the user typed it -- inclusive -- so it
 * is advanced by one day to become an exclusive bound. A single-day assignment
 * (start == end) is therefore one day, not zero, which is the off-by-one that
 * makes short assignments disappear in most implementations of this.
 */
export function resolveWindow(p: PeriodLike, simStart: Dayjs, simEnd: Dayjs): PeriodWindow {
    const rawStart = p.startDate ? dayjs(p.startDate).startOf('day') : simStart;
    const rawEnd = p.endDate ? dayjs(p.endDate).startOf('day').add(1, 'day') : simEnd;

    const start = rawStart.isBefore(simStart) ? simStart : rawStart;
    const end = rawEnd.isAfter(simEnd) ? simEnd : rawEnd;

    const days = end.isAfter(start) ? end.diff(start, 'day') : 0;
    // With weekends allowed every calendar day is billable, so the two counts
    // coincide and the rest of the arithmetic needs no special case.
    const workingDays = p.includeWeekends ? days : workingDaysBetween(start, end);
    return { start, end, days, workingDays, openEnded: !p.endDate };
}

export interface PeriodTotals {
    /** Calendar days spanned, for display. */
    days: number;
    /** Monday-to-Friday days, which is what is billed. */
    workingDays: number;
    hours: number;
    cost: number;
    /**
     * What this period costs per 30.44-day month WHILE IT IS RUNNING.
     *
     * A rate, not a total: useful for comparing two assignments, meaningless
     * as a budget line for anything shorter than a month. `cost` is the figure
     * that belongs in a budget.
     */
    perMonthWhileActive: number;
}

/**
 * Hours and money for one period, over its real dates.
 *
 * Weekly hours are spread across the five working days, matching the schedule
 * and report tabs. A Monday-to-Friday booking therefore costs exactly one week
 * of hours, and a weekend on its own costs nothing -- which is the point of a
 * working week.
 */
export function periodTotals(p: PeriodLike, simStart: Dayjs, simEnd: Dayjs): PeriodTotals {
    const { days, workingDays } = resolveWindow(p, simStart, simEnd);
    const hoursPerWorkingDay = p.weeklyHours / (p.includeWeekends ? 7 : WORKING_DAYS_PER_WEEK);
    const hours = hoursPerWorkingDay * workingDays;
    return {
        days,
        workingDays,
        hours,
        cost: hours * p.hourlyRate,
        perMonthWhileActive: p.hourlyRate * p.weeklyHours * AVG_WEEKS_PER_MONTH,
    };
}

/**
 * The most hours per week a member is committed to at any one moment.
 *
 * Periods are allowed to overlap, and the engine adds them together, so two
 * overlapping 20 h/wk assignments really do bill 40 h/wk. Nothing compared
 * that against the person's cap, so a simulation could quietly plan work
 * nobody is allowed to do. This walks the boundaries and returns the worst
 * point, which is what a cap has to be checked against.
 */
export function peakWeeklyHours(periods: PeriodLike[], simStart: Dayjs, simEnd: Dayjs): number {
    const windows = periods
        .map((p) => ({ w: resolveWindow(p, simStart, simEnd), hours: p.weeklyHours }))
        .filter((x) => x.w.days > 0);
    if (!windows.length) return 0;

    // The total can only change where some period starts or ends.
    const edges = new Set<number>();
    for (const { w } of windows) {
        edges.add(w.start.valueOf());
        edges.add(w.end.valueOf());
    }

    let peak = 0;
    for (const edge of edges) {
        let total = 0;
        for (const { w, hours } of windows) {
            if (edge >= w.start.valueOf() && edge < w.end.valueOf()) total += hours;
        }
        if (total > peak) peak = total;
    }
    return peak;
}

/** Whether a member's plan asks for more hours than they are allowed. */
export function capStatus(periods: PeriodLike[], cap: number, simStart: Dayjs, simEnd: Dayjs):
    { peak: number; cap: number; over: boolean; overlapping: boolean } {
    const peak = peakWeeklyHours(periods, simStart, simEnd);
    const maxSingle = periods.reduce((m, p) => Math.max(m, p.weeklyHours), 0);
    return {
        peak,
        cap,
        over: cap > 0 && peak > cap + 1e-9,
        // Peak above any single period means two periods run at the same time.
        overlapping: peak > maxSingle + 1e-9,
    };
}
