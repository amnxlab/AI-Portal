/**
 * Where a notification should take you.
 *
 * One table, used by both the bell menu and the notifications page. They each
 * had their own copy of this before, which is how five notification types came
 * to do nothing at all when clicked: a type added to one switch was never
 * added to the other, and neither had a default worth the name.
 *
 * Two rules hold everything together:
 *
 *   1. Every notification resolves to somewhere. A type nobody has mapped
 *      lands on the notifications page, which at least shows the message in
 *      full. Returning nothing is not an option -- a click that does nothing
 *      reads as a broken application.
 *
 *   2. The destination is as specific as the payload allows. An id gives the
 *      exact item; no id gives the section that lists it. Never /home.
 */

export interface NotificationLike {
    type: string;
    entityId?: string | null;
    entityType?: string | null;
    context?: Record<string, unknown> | null;
}

/** Builds `/path?a=1&b=2`, dropping empty values so no `?x=undefined` appears. */
export function withParams(path: string, params: Record<string, string | null | undefined>): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== '') q.set(k, v);
    }
    const s = q.toString();
    return s ? `${path}?${s}` : path;
}

/** The comment a mention points at, when the payload carries one. */
function commentIdOf(n: NotificationLike): string | undefined {
    const c = n.context as { commentId?: unknown } | null | undefined;
    return typeof c?.commentId === 'string' ? c.commentId : undefined;
}

/**
 * Where the thing a comment is attached to lives.
 *
 * Mentions are the only notification whose destination depends entirely on
 * entityType, because a comment can hang off almost anything.
 */
function entityTarget(entityType: string | null | undefined, id: string | null | undefined,
                      extra: Record<string, string | undefined>): string | null {
    if (!id) return null;
    switch (entityType) {
        case 'task':        return withParams('/tasks', { taskId: id, ...extra });
        case 'ticket':      return withParams('/tickets', { ticketId: id, ...extra });
        case 'project':     return withParams(`/projects/${id}`, extra);
        case 'report':      return withParams('/reports', { reportId: id, ...extra });
        case 'paper':       return withParams('/papers', { paperId: id, ...extra });
        case 'manual':      return withParams('/manuals', { fileId: id, ...extra });
        case 'file':        return withParams('/files', { fileId: id, ...extra });
        case 'video_media': return withParams('/video-tutorials', { mediaId: id, ...extra });
        default:            return null;
    }
}

/**
 * The page that can review a file, which depends on what kind of file it is.
 *
 * A manual and a paper are both rows in `files`, so a notification that only
 * said "a file needs review" could not say where to review it. The uploader's
 * own title said which -- "New manual awaiting review" -- while the payload
 * did not, and every one of them landed on the same page regardless.
 */
function fileTarget(n: NotificationLike): string {
    const id = n.entityId ?? undefined;
    switch (n.entityType) {
        case 'manual':
            return withParams('/manuals', { fileId: id });
        case 'paper':
            // The papers page opens by paper id, and a file awaiting approval
            // does not have one yet, so send the reviewer to the page and let
            // its pending list show the item rather than fail a lookup.
            return '/papers';
        default:
            return withParams('/files', { fileId: id });
    }
}

/**
 * The route for a notification. Always a string: see rule 1 above.
 */
export function notificationTarget(n: NotificationLike): string {
    const id = n.entityId ?? undefined;
    const commentId = commentIdOf(n);

    switch (n.type) {
        // ── Conversations ────────────────────────────────────────────────
        case 'comment_mention':
        case 'comment_reply':
        case 'discussion_reply':
            return entityTarget(n.entityType, id, { commentId })
                // A mention on something this table does not know about is
                // still worth reading, so fall through to the full message.
                ?? '/notifications';

        // ── Tasks ────────────────────────────────────────────────────────
        case 'task_assigned':
        case 'task_updated':
        case 'task_pending_review':
        case 'task_completed':
        case 'task_comment':
            return id ? withParams('/tasks', { taskId: id, commentId }) : '/tasks';

        // ── Papers ───────────────────────────────────────────────────────
        case 'paper_read_request':
        case 'paper_read_accepted':
        case 'paper_read_rejected':
            return id ? withParams('/papers', { paperId: id }) : '/papers';

        // ── Manuals ──────────────────────────────────────────────────────
        case 'manual_read_request':
        case 'manual_read_accepted':
        case 'manual_read_rejected':
            return id ? withParams('/manuals', { fileId: id }) : '/manuals';

        // ── Files, whose page depends on their kind ──────────────────────
        case 'file_pending':
        case 'file_approved':
        case 'file_rejected':
            return fileTarget(n);

        // ── Reports ──────────────────────────────────────────────────────
        case 'report_submitted':
        case 'report_resubmitted':
        case 'report_approved':
        case 'report_needs_revision':
            return id ? withParams('/reports', { reportId: id }) : '/reports';
        case 'report_reminder':
            // Deliberately has no id: it is a nudge to write this week's
            // report, not a pointer to one that exists.
            return '/reports';

        // ── Video tutorials ──────────────────────────────────────────────
        case 'video_pending':
        case 'video_approved':
        case 'video_rejected':
            return id ? withParams('/video-tutorials', { mediaId: id }) : '/video-tutorials';

        // ── Tickets ──────────────────────────────────────────────────────
        case 'ticket_submitted':
        case 'ticket_resolved':
        case 'ticket_updated':
            return id ? withParams('/tickets', { ticketId: id }) : '/tickets';

        // ── Schedules ────────────────────────────────────────────────────
        case 'schedule_submitted':
        case 'schedule_reviewed':
            return id ? withParams('/schedule', { scheduleId: id }) : '/schedule';

        // ── Shifts ───────────────────────────────────────────────────────
        case 'shift_assigned':
        case 'shift_ended':
        case 'shift_updated':
            return withParams('/attendance', { tab: 'shifts' });

        // ── Anything added later ─────────────────────────────────────────
        default:
            // Guess from the entity before giving up: a new type on a known
            // entity still lands in the right place.
            return entityTarget(n.entityType, id, { commentId }) ?? '/notifications';
    }
}
