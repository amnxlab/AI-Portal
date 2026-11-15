import type { SemanticTokens } from '../theme/tokens';

/* ═══════════════════════════════════════════════════════════════
   Task status — the single vocabulary.
   ───────────────────────────────────────────────────────────────
   WHY THIS EXISTS

   The status vocabulary was forked across the frontend:

     TasksPage    ['Todo', 'In Progress', 'Pending Review',
                   'Done', 'Needs Revision']
     ReportsPage  ['To Do', 'In Progress', 'Done', 'Needs Revision']
                  …plus a colour map keyed on BOTH 'To Do' and 'Todo'
                  to paper over the mismatch.

   The backend is unambiguous — see `tasks/dto/create-task.dto.ts` and the
   CHECK constraint on `tasks.status` in `database/schema.sql`:

     'Todo' | 'In Progress' | 'Pending Review' | 'Needs Revision'
            | 'Blocked' | 'Done'

   Two consequences that were live bugs:
     · 'To Do' (with a space) is not a valid status anywhere. Any Reports
       filter or comparison against it silently matched nothing.
     · 'Blocked' is valid and persisted, but no frontend view listed it —
       a blocked task disappeared from the Kanban board entirely.

   Both are fixed by importing from here rather than re-declaring locally.
═══════════════════════════════════════════════════════════════ */

export const TASK_STATUSES = [
    'Todo',
    'In Progress',
    'Pending Review',
    'Needs Revision',
    'Blocked',
    'Done',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Board column order. Every status appears exactly once — that invariant
 *  is what stopped 'Blocked' tasks from going missing. */
export const TASK_BOARD_COLUMNS: readonly TaskStatus[] = [
    'Todo',
    'In Progress',
    'Pending Review',
    'Needs Revision',
    'Blocked',
    'Done',
];

/** Statuses shown before the user opts into seeing finished work. */
export const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
    'Todo',
    'In Progress',
    'Pending Review',
    'Needs Revision',
    'Blocked',
]);

/**
 * Display label for a status.
 *
 * 'Pending Review' reads differently depending on which side of the review
 * you are on: the reviewer has something pending, the submitter is waiting.
 * That nuance already existed in TasksPage and is preserved here so both
 * pages phrase it the same way.
 */
export function taskStatusLabel(status: string, isReviewer: boolean): string {
    if (status === 'Pending Review' && !isReviewer) return 'Under Review';
    return status;
}

/** Status → colour, resolved against the active theme. */
export function taskStatusColor(status: string, t: SemanticTokens): string {
    switch (status) {
        case 'Todo':            return t.accent;
        case 'In Progress':     return t.warning;
        case 'Pending Review':  return t.purple;
        case 'Needs Revision':  return t.orange;
        case 'Blocked':         return t.danger;
        case 'Done':            return t.success;
        default:                return t.textMuted;
    }
}

/** Matching low-alpha fill, safe in both themes. */
export function taskStatusBg(status: string, t: SemanticTokens): string {
    switch (status) {
        case 'Todo':            return t.accentBg;
        case 'In Progress':     return t.warningBg;
        case 'Pending Review':  return t.purpleBg;
        case 'Needs Revision':  return t.orangeBg;
        case 'Blocked':         return t.dangerBg;
        case 'Done':            return t.successBg;
        default:                return t.surfaceSunken;
    }
}

/** Normalise a status string coming from anywhere (legacy rows, the
 *  Reports module's 'To Do', user input) onto the canonical vocabulary. */
export function normalizeTaskStatus(raw: string | null | undefined): TaskStatus {
    if (!raw) return 'Todo';
    const s = raw.trim();
    if ((TASK_STATUSES as readonly string[]).includes(s)) return s as TaskStatus;
    // Tolerate the historical 'To Do' spelling and casing drift.
    const collapsed = s.toLowerCase().replace(/[\s_-]/g, '');
    const match = TASK_STATUSES.find(
        (v) => v.toLowerCase().replace(/[\s_-]/g, '') === collapsed,
    );
    return match ?? 'Todo';
}

/* ── Report status ─────────────────────────────────────────────
   Separate vocabulary, same treatment. Backend: the CHECK constraint on
   `weekly_reports.status` in database/schema.sql.                      */

export const REPORT_STATUSES = [
    'Draft',
    'Submitted',
    'Approved',
    'Needs Revision',
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export function reportStatusColor(status: string, t: SemanticTokens): string {
    switch (status) {
        case 'Draft':          return t.textMuted;
        case 'Submitted':      return t.accent;
        case 'Approved':       return t.success;
        case 'Needs Revision': return t.orange;
        default:               return t.textMuted;
    }
}

export function reportStatusBg(status: string, t: SemanticTokens): string {
    switch (status) {
        case 'Draft':          return t.surfaceSunken;
        case 'Submitted':      return t.accentBg;
        case 'Approved':       return t.successBg;
        case 'Needs Revision': return t.orangeBg;
        default:               return t.surfaceSunken;
    }
}

/* ── Priority ──────────────────────────────────────────────────── */

export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function taskPriorityColor(priority: string, t: SemanticTokens): string {
    switch (priority) {
        case 'Critical': return t.danger;
        case 'High':     return t.orange;
        case 'Medium':   return t.warning;
        case 'Low':      return t.success;
        default:         return t.textMuted;
    }
}

export function taskPriorityBg(priority: string, t: SemanticTokens): string {
    switch (priority) {
        case 'Critical': return t.dangerBg;
        case 'High':     return t.orangeBg;
        case 'Medium':   return t.warningBg;
        case 'Low':      return t.successBg;
        default:         return t.surfaceSunken;
    }
}
