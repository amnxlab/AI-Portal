import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

/* ═══════════════════════════════════════════════════════════════
   Display formatting.
   ───────────────────────────────────────────────────────────────
   Currency, hours and date formatting were re-declared per file — every
   Budget tab had its own `fmt`, and each page picked its own date format
   inline. That is why the Settings page's "Date format" selector had no
   effect: there was no shared reader for it to change.

   These helpers read the user's stored preference, so that control now
   does what it claims.
═══════════════════════════════════════════════════════════════ */

export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const PREFS_STORAGE_KEY = 'aiml-portal-prefs';

export interface DisplayPreferences {
    dateFormat: DateFormat;
    /** IANA zone name, or 'system' to follow the browser. */
    timezone: string;
}

export const DEFAULT_PREFERENCES: DisplayPreferences = {
    dateFormat: 'MM/DD/YYYY',
    timezone: 'system',
};

export function readPreferences(): DisplayPreferences {
    try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        if (!raw) return DEFAULT_PREFERENCES;
        const parsed = JSON.parse(raw) as Partial<DisplayPreferences>;
        return {
            dateFormat: DATE_FORMATS.includes(parsed.dateFormat as DateFormat)
                ? (parsed.dateFormat as DateFormat)
                : DEFAULT_PREFERENCES.dateFormat,
            timezone: parsed.timezone ?? DEFAULT_PREFERENCES.timezone,
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

export function writePreferences(prefs: DisplayPreferences): void {
    try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch { /* non-fatal */ }
}

/* ── Dates ─────────────────────────────────────────────────────── */

type DateInput = Dayjs | string | Date | null | undefined;

/** Apply the user's chosen timezone, if any — 'system' leaves it to the browser. */
function inUserZone(d: Dayjs): Dayjs {
    const { timezone: tz } = readPreferences();
    return tz === 'system' ? d : d.tz(tz);
}

/** Date only, in the user's chosen format and timezone. */
export function formatDate(value: DateInput, fallback = '—'): string {
    if (!value) return fallback;
    const d = dayjs(value);
    return d.isValid() ? inUserZone(d).format(readPreferences().dateFormat) : fallback;
}

/** Date + 24h time. */
export function formatDateTime(value: DateInput, fallback = '—'): string {
    if (!value) return fallback;
    const d = dayjs(value);
    return d.isValid() ? inUserZone(d).format(`${readPreferences().dateFormat} HH:mm`) : fallback;
}

export function formatTime(value: DateInput, fallback = '—'): string {
    if (!value) return fallback;
    const d = dayjs(value);
    return d.isValid() ? inUserZone(d).format('HH:mm') : fallback;
}

/** '3 days ago', 'in 2 hours'. */
export function formatRelative(value: DateInput, fallback = '—'): string {
    if (!value) return fallback;
    const d = dayjs(value);
    return d.isValid() ? d.fromNow() : fallback;
}

/** Days until a deadline. Negative means overdue. */
export function daysUntil(value: DateInput): number | null {
    if (!value) return null;
    const d = dayjs(value);
    if (!d.isValid()) return null;
    return d.endOf('day').diff(dayjs().startOf('day'), 'day');
}

/* ── Numbers ───────────────────────────────────────────────────── */

/** USD, always two decimals. Replaces the per-Budget-tab `fmt` helpers. */
export function formatCurrency(value: number | string | null | undefined): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '$0.00';
    return `$${n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/** Compact currency for dense tiles: '$1.2k', '$3.4M'. */
export function formatCurrencyCompact(value: number | string | null | undefined): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '$0';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
    return `$${n.toFixed(0)}`;
}

/**
 * Hours, trimmed. `7` → '7h', `7.5` → '7.5h'.
 *
 * Note the explicit `Number()`: TypeORM serialises bigint and numeric
 * columns as strings, and the old code hit string-concatenation bugs by
 * adding them directly (see the `totalPausedMs` guards in TasksPage).
 */
export function formatHours(value: number | string | null | undefined, suffix = 'h'): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return `0${suffix}`;
    const rounded = Math.round(n * 100) / 100;
    return `${rounded}${suffix}`;
}

/** Elapsed milliseconds as '2h 14m 07s' / '14m 07s'. */
export function formatDuration(ms: number | string | null | undefined): string {
    const total = Math.max(0, Number(ms ?? 0));
    if (!Number.isFinite(total)) return '0m 00s';
    const hrs  = Math.floor(total / 3_600_000);
    const mins = Math.floor((total % 3_600_000) / 60_000);
    const secs = Math.floor((total % 60_000) / 1_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return hrs > 0 ? `${hrs}h ${pad(mins)}m ${pad(secs)}s` : `${mins}m ${pad(secs)}s`;
}

export function formatPercent(value: number | null | undefined, decimals = 0): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '0%';
    return `${n.toFixed(decimals)}%`;
}

/** Byte size for file listings. */
export function formatBytes(bytes: number | string | null | undefined): string {
    const n = Number(bytes ?? 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    const v = n / 1024 ** i;
    return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/* ── Text ──────────────────────────────────────────────────────── */

/** Up to two initials from a full name. */
export function initials(fullName: string | null | undefined): string {
    if (!fullName?.trim()) return '?';
    return fullName
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
}

export function truncate(text: string | null | undefined, max = 60): string {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** '1 task' / '2 tasks' — the app builds this inline in a dozen places. */
export function pluralize(count: number, singular: string, plural?: string): string {
    return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}
