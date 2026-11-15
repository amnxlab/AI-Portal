import type { NavigateFunction } from 'react-router-dom';
import { notificationTarget } from './notificationTarget';

export type NotifCategory = 'tasks' | 'reports' | 'files' | 'papers' | 'tickets' | 'tutorials' | 'other';

export function getNotifCategory(type: string, entityType?: string): NotifCategory {
    if (type === 'comment_mention') {
        if (entityType === 'task')        return 'tasks';
        if (entityType === 'ticket')      return 'tickets';
        if (entityType === 'video_media') return 'tutorials';
        return 'other';
    }
    if (type.startsWith('task_'))    return 'tasks';
    if (type.startsWith('report_'))  return 'reports';
    if (type.startsWith('file_'))    return 'files';
    if (type.startsWith('video_'))   return 'tutorials';
    if (type.startsWith('paper_'))   return 'papers';
    if (type.startsWith('ticket_'))  return 'tickets';
    return 'other';
}

/**
 * Go wherever this notification points.
 *
 * The destination comes from notificationTarget(), which every caller shares.
 * This used to hold a third copy of the routing switch, and it navigated with
 * router *state* rather than a URL -- so the target survived an in-app click
 * but was lost on a reload and on the redirect back from the login page,
 * which is precisely when a notification link gets followed.
 */
export function navigateToEntity(notif: any, navigate: NavigateFunction): void {
    navigate(notificationTarget(notif));
}

