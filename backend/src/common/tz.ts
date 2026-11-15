/**
 * Lab-timezone date arithmetic.
 *
 * Every attendance timestamp is stored in UTC (timestamptz). Working days,
 * weekly boundaries and report periods are defined in the lab's local time —
 * Mountain Time, including daylight saving — regardless of the timezone the
 * server process or the viewer's browser happens to be in.
 *
 * Implemented on Intl only (no dependency): Node ships full ICU.
 */
export const LAB_TZ = process.env.LAB_TIMEZONE || 'America/Denver';

/** A calendar day in the lab timezone: 'YYYY-MM-DD'. */
export type LocalDate = string;

const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: LAB_TZ,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
});

interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; ss: number }

export function localParts(instant: Date): LocalParts {
    const out: Record<string, number> = {};
    for (const p of partsFmt.formatToParts(instant)) {
        if (p.type !== 'literal') out[p.type] = Number(p.value);
    }
    return { y: out.year, m: out.month, d: out.day, hh: out.hour, mm: out.minute, ss: out.second };
}

/** Offset of the lab timezone at `instant`, in ms (local = utc + offset). */
export function tzOffsetMs(instant: Date): number {
    const p = localParts(instant);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function isLocalDate(s: unknown): s is LocalDate {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The lab-local calendar day an instant falls on. */
export function localDateOf(instant: Date): LocalDate {
    const p = localParts(instant);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Today in the lab timezone. */
export function localToday(): LocalDate {
    return localDateOf(new Date());
}

/** Pure calendar arithmetic — no timezone involved. */
export function addDays(date: LocalDate, n: number): LocalDate {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dow === 0 ? 7 : dow;
}

/**
 * The instant at which a lab-local wall-clock time occurs.
 * Handles DST: the offset is resolved at the target instant, not "now".
 */
export function localToInstant(date: LocalDate, hh = 0, mm = 0, ss = 0): Date {
    const [y, m, d] = date.split('-').map(Number);
    const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
    let t = wall - tzOffsetMs(new Date(wall));
    // Second pass settles the rare case where the first guess sat on the
    // other side of a DST transition.
    t = wall - tzOffsetMs(new Date(t));
    return new Date(t);
}

/** Local midnight that begins `date`. */
export function startOfLocalDay(date: LocalDate): Date {
    return localToInstant(date, 0, 0, 0);
}

/** The Monday (lab-local) of the week containing the given day or instant. */
export function weekStartOf(v: LocalDate | Date): LocalDate {
    const date = v instanceof Date ? localDateOf(v) : v;
    return addDays(date, -(isoWeekday(date) - 1));
}

export function isMonday(date: LocalDate): boolean {
    return isLocalDate(date) && isoWeekday(date) === 1;
}

export interface Interval { start: Date; end: Date }

/** [Monday 00:00, next Monday 00:00) in lab-local time. */
export function weekInterval(weekStart: LocalDate): Interval {
    return { start: startOfLocalDay(weekStart), end: startOfLocalDay(addDays(weekStart, 7)) };
}

/** [00:00, next day 00:00) in lab-local time. 23 or 25 hours long on DST days. */
export function dayInterval(date: LocalDate): Interval {
    return { start: startOfLocalDay(date), end: startOfLocalDay(addDays(date, 1)) };
}

/** [first of month 00:00, first of next month 00:00). `month` is 'YYYY-MM'. */
export function monthInterval(month: string): Interval & { days: LocalDate[] } {
    const [y, m] = month.split('-').map(Number);
    const first = `${y}-${pad(m)}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
    const days: LocalDate[] = [];
    for (let d = first; d < next; d = addDays(d, 1)) days.push(d);
    return { start: startOfLocalDay(first), end: startOfLocalDay(next), days };
}

/** Milliseconds of [aStart, aEnd) that fall inside the interval. */
export function overlapMs(aStart: Date, aEnd: Date, iv: Interval): number {
    const s = Math.max(aStart.getTime(), iv.start.getTime());
    const e = Math.min(aEnd.getTime(), iv.end.getTime());
    return Math.max(0, e - s);
}

export const msToHours = (ms: number) => ms / 3_600_000;
export const round2 = (n: number) => Math.round(n * 100) / 100;

const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: LAB_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: LAB_TZ, month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
});
const longDateFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAB_TZ, day: '2-digit', month: 'long', year: 'numeric',
});

/** 'HH:mm' in lab-local time. */
export const formatLocalTime = (instant: Date) => timeFmt.format(instant);
/** 'Nov 11, 2026, 09:30 MST' in lab-local time. */
export const formatLocalDateTime = (instant: Date) => dateTimeFmt.format(instant);
/** '11 November 2026' in lab-local time. */
export const formatLocalLongDate = (instant: Date) => longDateFmt.format(instant);
