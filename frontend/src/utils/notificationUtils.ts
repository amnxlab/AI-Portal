import type { NavigateFunction } from 'react-router-dom';

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

export function navigateToEntity(notif: any, navigate: NavigateFunction): void {
    switch (notif.type) {
        case 'comment_mention':
            if (notif.entityType === 'task')        { navigate('/tasks',            { state: { openTaskId:   notif.entityId } }); return; }
            if (notif.entityType === 'ticket')      { navigate('/tickets',          { state: { openTicketId: notif.entityId } }); return; }
            if (notif.entityType === 'project')     { navigate(`/projects/${notif.entityId ?? ''}`); return; }
            if (notif.entityType === 'video_media') { navigate('/video-tutorials', { state: { openMediaId: notif.entityId, scrollToDiscussion: true } }); return; }
            return;
        case 'task_assigned':
        case 'task_updated':
        case 'task_pending_review':
            navigate('/tasks', { state: { openTaskId: notif.entityId } }); return;
        case 'paper_read_request':
        case 'paper_read_accepted':
        case 'paper_read_rejected':
            navigate('/papers', { state: { openPaperId: notif.entityId } }); return;
        case 'report_approved':
        case 'report_needs_revision':
        case 'report_submitted':
        case 'report_resubmitted':
            navigate('/reports', { state: { openReportId: notif.entityId } }); return;
        case 'file_approved':
        case 'file_rejected':
        case 'file_pending':
            navigate('/files', { state: { openFileId: notif.entityId } }); return;
        case 'video_pending':
        case 'video_approved':
        case 'video_rejected':
            navigate('/video-tutorials', { state: { openMediaId: notif.entityId } }); return;
        case 'ticket_submitted':
        case 'ticket_resolved':
            navigate('/tickets', { state: { openTicketId: notif.entityId } }); return;
        default: return;
    }
}
