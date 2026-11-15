import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import UserAvatar from '../../components/UserAvatar';
import CommentThread from '../../components/CommentThread';
import TaskFormModal from '../../components/TaskFormModal';
import { NotifyByEmailButton } from '../../components/useTaskEmailNotify';
import { FormModal } from '../../components/ui';
import { useTheme } from '../../theme/useTheme';
import Markdown, { MarkdownPreview } from '../../components/Markdown';
import { alpha } from '../../theme/tokens';
import {
    Button, Modal, Select, Typography, Alert,
    Spin, Tag, Space, Tooltip, Popconfirm, message,
    Segmented, Table, Progress, Collapse, Badge, Descriptions,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import {
    PlusOutlined, DeleteOutlined, EditOutlined, CalendarOutlined,
    TableOutlined, ProjectOutlined, AppstoreOutlined, CheckCircleOutlined,
    ClockCircleOutlined, RedoOutlined, ExclamationCircleOutlined, SendOutlined, AuditOutlined, EyeOutlined,
    ThunderboltOutlined, PauseCircleOutlined, PlayCircleOutlined, ReadOutlined,
    LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import { Calendar, dayjsLocalizer } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
dayjs.extend(isoWeek);
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useDeepLinkId } from '../../hooks/useDeepLink';

const localizer = dayjsLocalizer(dayjs);
const { Title, Text } = Typography;

/* ────────────────────────────── constants ────────────────────────────── */
const COLUMNS = ['Todo', 'In Progress', 'Pending Review', 'Done', 'Needs Revision'] as const;

// Statuses shown by default — Done is hidden until the user explicitly reveals it.
const ACTIVE_STATUSES = new Set(['Todo', 'In Progress', 'Pending Review', 'Needs Revision']);

/* ═══════════════════════════ types ═════════════════════════════════════ */
interface Task {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    deadline: string;
    estimatedHours: number;
    actualHours?: number;
    assigneeId: string;
    projectId: string;
    subProjectId?: string;
    createdBy?: string;
    assignee?: { fullName: string; id: string; avatarUrl?: string | null; role?: string; permissions?: Record<string, boolean> | null };
    creator?: { fullName: string; id: string; avatarUrl?: string | null; role?: string; permissions?: Record<string, boolean> | null };
    project?: { name: string };
    subProject?: { name: string };
    createdAt: string;
    startedAt?: string | null;
    pausedAt?: string | null;
    totalPausedMs?: number;
    paperId?: string | null;
}
interface Project { id: string; name: string; }
interface User    { id: string; fullName: string; role: string; weeklyHoursCap?: number | null; permissions?: Record<string, boolean> | null; }

/* ──────────────── live timer component for In-Progress tasks ────────── */
const TaskTimer = ({ task, onPause, onResume }: {
    task: Task;
    onPause: () => void;
    onResume: () => void;
}) => {
    const { t } = useTheme();
    const [tick, setTick] = useState(Date.now());
    const isPaused = !!task.pausedAt;

    useEffect(() => {
        if (isPaused) return;
        const id = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [isPaused]);

    const now = isPaused ? new Date(task.pausedAt!).getTime() : tick;
    const startMs = task.startedAt ? new Date(task.startedAt).getTime() : tick;
    // totalPausedMs arrives from the server as a bigint string (e.g. "5000").
    // Always force-convert to number to prevent string concatenation bugs.
    const pausedMs = Number(task.totalPausedMs ?? 0);
    const elapsed = Math.max(0, now - startMs - pausedMs);

    const hrs = Math.floor(elapsed / 3_600_000);
    const mins = Math.floor((elapsed % 3_600_000) / 60_000);
    const secs = Math.floor((elapsed % 60_000) / 1_000);
    const display = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Tag style={{
                background: isPaused ? alpha(t.warning, 0.13) : alpha(t.success, 0.13),
                color: isPaused ? t.warning : t.success,
                border: `1px solid ${isPaused ? alpha(t.warning, 0.27) : alpha(t.success, 0.27)}`,
                fontFamily: 'monospace', fontSize: 13, padding: '2px 8px', margin: 0,
            }}>
                {isPaused ? '⏸ ' : '⏱ '}{display}
            </Tag>
            <Tooltip title={isPaused ? 'Resume Timer' : 'Pause Timer'}>
                <Button
                    size="small"
                    type="text"
                    icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                    onClick={isPaused ? onResume : onPause}
                    style={{ color: isPaused ? t.success : t.warning }}
                />
            </Tooltip>
        </div>
    );
};

/** Maps raw task status to the label shown in the UI.
 *  Task reviewers (manage_projects / manage_tasks) see "Pending Review";
 *  submitters see "Under Review" — identical wording for every role. */
const statusLabel = (status: string, isReviewer: boolean) =>
    !isReviewer && status === 'Pending Review' ? 'Under Review' : status;

/* ═══════════════════════════ component ══════════════════════════════════ */
export default function TasksPage() {
    const deepLinkId = useDeepLinkId('taskId', 'openTaskId');
    const navigate   = useNavigate();
    const user      = useAuthStore((s) => s.user);
    const { hasPermission } = usePermissions();
    const { t } = useTheme();
    // Every gate below mirrors the backend rules in tasks.service.ts exactly.
    // There is no role name involved: full project authority replaces the old
    // Project/task authority checks, and a task's creator is identified by
    // the manage_tasks permission rather than by role.
    const canManageAllTasks = hasPermission('manage_projects');
    /*
     * Who is offered the assignment email.
     *
     * Full project authority, or a project leader. A leader's authority is
     * per project and this page spans every project, so which ones they
     * lead is not known here — the server checks the task's own project and
     * says so plainly if they do not lead it.
     */
    const canNotifyByEmail = hasPermission('manage_projects') || hasPermission('lead_projects');
    const canCreate        = hasPermission('manage_tasks');
    /** Who may set a task to "Done": global project authority, or a task
     *  manager who is not merely a scoped project leader (leaders must submit
     *  for review instead). Mirrors the backend update rules. */
    const canMarkDone = canManageAllTasks || (canCreate && !hasPermission('lead_projects'));
    /** Reviewers see the raw "Pending Review" status; submitters see "Under Review". */
    const isReviewer = canManageAllTasks || canCreate;
    // True when the current user is managing this task (global authority
    // always; task managers only when it is not their own assignment).
    const isManagingTask = (task: Task) => canManageAllTasks || (canCreate && task.assigneeId !== user?.id);
    /** Whether the current user may edit/manage this task. Full project
     *  authority always can; a task manager (manage_tasks) can edit any task
     *  the backend lets them see. Scoped project leaders are the only ones
     *  blocked from editing tasks authored by a task authority. */
    const canLeaderEdit = (task: Task) =>
        canManageAllTasks || canCreate || task.creator?.permissions?.manage_tasks !== true;

    const [tasks,    setTasks]    = useState<Task[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [users,    setUsers]    = useState<User[]>([]);
    const [loading,  setLoading]  = useState(false);
    const [error,    setError]    = useState<string | null>(null);

    const [activeView,       setActiveView]       = useState<'kanban' | 'list' | 'calendar' | 'byproject'>('list');
    const [selectedProject,  setSelectedProject]  = useState<string | undefined>();
    const [modalOpen,        setModalOpen]        = useState(false);
    const [editTask,         setEditTask]         = useState<Task | null>(null);
    const [modalDefaultStatus, setModalDefaultStatus] = useState<string>('Todo');
    const [modalPrefilledProjectId, setModalPrefilledProjectId] = useState<string | undefined>(undefined);
    const [saveLoading,      setSaveLoading]      = useState(false);
    const [calendarTask,     setCalendarTask]     = useState<Task | null>(null);
    const [viewTask,         setViewTask]         = useState<Task | null>(null);
    const [taskProjectMembers, setTaskProjectMembers] = useState<{ id: string; fullName: string; role: string; avatarUrl?: string | null }[]>([]);
    const [filterMode,  setFilterMode]  = useState<'all' | 'focus'>('all');
    const [weekFilter,   setWeekFilter]   = useState(() => dayjs().isoWeekday(1).format('YYYY-MM-DD'));
    const [showAll,      setShowAll]      = useState(false);
    const [selectedAssignee, setSelectedAssignee] = useState<string | undefined>();

    /* ── theme-aware status / priority helpers ─────────────────────────── */
    const statusColor = (status: string) => {
        switch (status) {
            case 'Todo': return t.accent;
            case 'In Progress': return t.warning;
            case 'Pending Review': return t.purple;
            case 'Done': return t.success;
            case 'Needs Revision': return t.orange;
            default: return t.textMuted;
        }
    };

    const statusIcon = (status: string): ReactElement | null => {
        const color = statusColor(status);
        switch (status) {
            case 'Todo': return <ClockCircleOutlined style={{ color }} />;
            case 'In Progress': return <ExclamationCircleOutlined style={{ color }} />;
            case 'Pending Review': return <SendOutlined style={{ color }} />;
            case 'Done': return <CheckCircleOutlined style={{ color }} />;
            case 'Needs Revision': return <RedoOutlined style={{ color }} />;
            default: return null;
        }
    };

    const priorityColor = (priority: string) => {
        switch (priority) {
            case 'Critical': return t.danger;
            case 'High': return t.orange;
            case 'Medium': return t.warning;
            case 'Low': return t.success;
            default: return t.textMuted;
        }
    };

    /* ── project colour lookup ─────────────────────────────────────────── */
    const projectColor = useCallback((id: string) => {
        const idx = projects.findIndex((p) => p.id === id);
        return t.chart[(idx < 0 ? 0 : idx) % t.chart.length];
    }, [projects, t.chart]);

    /* ── project member loader (for view modal CommentThread @mentions) ─────── */
    const fetchSubProjects = useCallback(async (projectId: string | undefined) => {
        if (!projectId) { setTaskProjectMembers([]); return; }
        try {
            const memRes = await api.get(`/projects/${projectId}/members`);
            setTaskProjectMembers(
                (memRes.data as { user: { id: string; fullName: string; role?: string; avatarUrl?: string | null } }[])
                    .map((m) => ({ id: m.user.id, fullName: m.user.fullName, role: m.user.role ?? '', avatarUrl: m.user.avatarUrl }))
            );
        } catch { setTaskProjectMembers([]); }
    }, []);

    /* ── data loading ──────────────────────────────────────────────────── */
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params: Record<string, string> = {};
            if (selectedProject) params.projectId = selectedProject;
            // Backend automatically scopes tasks to the requester for members without task authority
            // Load directory for all roles — needed for @mentions in comments
            const [tasksRes, projectsRes, usersRes] = await Promise.all([
                api.get('/tasks', { params }),
                api.get('/projects'),
                api.get('/users/directory'),
            ]);
            setTasks(tasksRes.data);
            setProjects(projectsRes.data);
            setUsers(usersRes.data);
            if (canCreate) {
                // Project/task authorities also need the full list for task assignment dropdowns
                // (already fetched above — nothing extra needed)
            }
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load tasks');
        } finally {
            setLoading(false);
        }
    }, [selectedProject, canCreate]);

    useEffect(() => { load(); }, [load]);

    /*
     * Deep link: open the task the link names.
     *
     * The loaded list is not enough to rely on. It is fetched per mode and
     * the board scopes to a week, so a task with no deadline, or one
     * outside the week on screen, is simply absent — and the link would
     * then do nothing at all, silently. When the task is not in hand it is
     * fetched by id, which also gives the server the chance to refuse it:
     * access is its decision, and a 403 is reported rather than swallowed.
     */
    const deepLinkTried = useRef<string | null>(null);
    useEffect(() => {
        const openId = deepLinkId;
        if (!openId || deepLinkTried.current === openId) return;

        const found = tasks.find((t) => t.id === openId);
        if (found) {
            deepLinkTried.current = openId;
            openView(found);
            return;
        }

        // Wait for the first load to finish before deciding it is missing.
        if (loading) return;
        deepLinkTried.current = openId;

        (async () => {
            try {
                const { data } = await api.get(`/tasks/${openId}`);
                openView(data);
            } catch (e: unknown) {
                const status = (e as { response?: { status?: number } })?.response?.status;
                message.error(
                    status === 403
                        ? 'You do not have access to that task.'
                        : status === 404
                            ? 'That task no longer exists.'
                            : 'Could not open that task.',
                );
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deepLinkId, tasks, loading]);

    /* ── week + mode filter ────────────────────────────────────────────── */
    // The week-swapper always applies — every mode scopes to the selected week.
    const weekStart = dayjs(weekFilter).startOf('day');
    const weekEnd   = weekStart.add(6, 'day').endOf('day');

    const baseTasks = (() => {
        // Base pool: tasks with a deadline that falls within Mon–Sun of the selected week.
        // Tasks without a deadline are excluded — they don't belong to any specific week.
        const weekPool = tasks.filter((t) =>
            !!t.deadline &&
            !dayjs(t.deadline).isBefore(weekStart) &&
            !dayjs(t.deadline).isAfter(weekEnd)
        );

        if (filterMode === 'focus') {
            // Show only the current user's own Todo & In Progress tasks within the week
            return weekPool.filter((t) =>
                (t.status === 'Todo' || t.status === 'In Progress') &&
                t.assigneeId === user?.id
            );
        }

        return weekPool;
    })();

    const statusFilteredTasks = showAll
        ? baseTasks
        : baseTasks.filter((t) => ACTIVE_STATUSES.has(t.status));

    const filteredTasks = selectedAssignee
        ? statusFilteredTasks.filter((t) => t.assigneeId === selectedAssignee)
        : statusFilteredTasks;

    // Count hidden tasks (Done) so the toggle badge is informative
    const hiddenCount = showAll ? 0 : baseTasks.filter((t) => !ACTIVE_STATUSES.has(t.status)).length;

    /* ── helpers ───────────────────────────────────────────────────────── */
    const tasksByStatus = (status: string) =>
        filteredTasks.filter((t) => t.status === status).sort((a, b) => a.title.localeCompare(b.title));

    /* ── modal open ────────────────────────────────────────────────────── */
    /* ── hour-cap helper ──────────────────────────────────────────────── */
    const openModal = (task?: Task, defaultStatus?: string, prefilledProjectId?: string) => {
        setEditTask(task ?? null);
        setModalDefaultStatus(defaultStatus ?? 'Todo');
        setModalPrefilledProjectId(prefilledProjectId ?? selectedProject);
        setModalOpen(true);
    };

    const openView = (task: Task) => { setViewTask(task); fetchSubProjects(task.projectId); };

    const handleTaskFormSave = async (values: Record<string, any>) => {
        setSaveLoading(true);
        try {
            // The saved task is returned so the form can email about a
            // brand-new one, whose id only exists after this call.
            let saved: { id?: string } | null = null;
            if (editTask) {
                const res = await api.patch(`/tasks/${editTask.id}`, values);
                saved = res.data ?? { id: editTask.id };
                message.success('Task updated');
            } else {
                const res = await api.post('/tasks', values);
                saved = res.data ?? null;
                message.success('Task created');
            }
            setModalOpen(false);
            load();
            return saved;
        } catch (e: any) {
            if (e?.response) message.error(e.response.data?.message ?? 'Save failed');
            throw e;
        } finally {
            setSaveLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/tasks/${id}`);
            message.success('Task deleted');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    /* ── kanban drag ───────────────────────────────────────────────────── */
    const handleDragEnd = async (result: DropResult) => {
        const { source, destination, draggableId } = result;
        if (!destination || source.droppableId === destination.droppableId) return;
        const newStatus = destination.droppableId;
        if (newStatus === 'Done' && !canMarkDone) {
            message.warning('You do not have permission to mark tasks as Done. Submit for review instead.');
            return;
        }
        setTasks((prev) => prev.map((t) => t.id === draggableId ? { ...t, status: newStatus } : t));
        try {
            await api.patch(`/tasks/${draggableId}`, { status: newStatus });
        } catch {
            message.error('Failed to update task status');
            load();
        }
    };

    /* ── quick status/hours update (used by Employee My Tasks view) ───────────────────── */
    const quickUpdate = async (taskId: string, updates: Partial<Task>) => {
        const currentTask = tasks.find((t) => t.id === taskId);
        const now = new Date().toISOString();
        const leavingInProgress = currentTask?.status === 'In Progress' && updates.status && updates.status !== 'In Progress';
        const returningToInProgress = updates.status === 'In Progress' && currentTask?.status !== 'In Progress';
        const optimistic: Partial<Task> = {
            ...updates,
            // Starting for the first time
            ...(returningToInProgress && !currentTask?.startedAt
                ? { startedAt: now }
                : {}),
            // Returning to In Progress: clear pausedAt and accumulate the gap into totalPausedMs
            ...(returningToInProgress && currentTask?.pausedAt
                ? {
                    pausedAt: null,
                    totalPausedMs: Number(currentTask.totalPausedMs ?? 0) +
                        (Date.now() - new Date(currentTask.pausedAt).getTime()),
                  }
                : {}),
            // Leaving In Progress: freeze the timer immediately in the UI
            ...(leavingInProgress && !currentTask?.pausedAt
                ? { pausedAt: now }
                : {}),
        };
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...optimistic } : t));
        try {
            await api.patch(`/tasks/${taskId}`, updates);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Update failed');
            load();
        }
    };

    /* ── pause / resume timer ────────────────────────────────────────────────────── */
    const pauseTask = async (taskId: string) => {
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, pausedAt: new Date().toISOString() } : t));
        try { await api.patch(`/tasks/${taskId}/pause`); }
        catch { message.error('Pause failed'); load(); }
    };
    const resumeTask = async (taskId: string) => {
        setTasks((prev) => prev.map((t) => {
            if (t.id !== taskId) return t;
            const addMs = t.pausedAt ? Date.now() - new Date(t.pausedAt).getTime() : 0;
            // Use Number() to guard against bigint-string concatenation:
            // TypeORM serialises bigint columns as strings, so (str || 0) + num
            // would produce string concatenation instead of addition.
            return { ...t, pausedAt: null, totalPausedMs: (Number(t.totalPausedMs) || 0) + addMs };
        }));
        try { await api.patch(`/tasks/${taskId}/resume`); }
        catch { message.error('Resume failed'); load(); }
    };

    /* ── shared sub-component: project tag ───────────────────────────────────────── */
    const ProjectBadge = ({ task }: { task: Task }) =>
        task.project ? (
            <Tag style={{
                background: alpha(projectColor(task.projectId), 0.13),
                color: projectColor(task.projectId),
                border: `1px solid ${alpha(projectColor(task.projectId), 0.33)}`,
                borderRadius: 4, fontSize: 10, padding: '0 5px', margin: 0,
            }}>
                {task.project.name}
            </Tag>
        ) : null;

    const SubProjectBadge = ({ task }: { task: Task }) =>
        task.subProject ? (
            <Tag style={{
                background: alpha(t.purple, 0.13),
                color: t.purple,
                border: `1px solid ${alpha(t.purple, 0.27)}`,
                borderRadius: 4, fontSize: 9, padding: '0 4px', margin: 0,
            }}>
                {task.subProject.name}
            </Tag>
        ) : null;

    /* ══════════════ VIEW: KANBAN ══════════════════════════════════════ */
    const KanbanView = () => (
        <DragDropContext onDragEnd={handleDragEnd}>
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16 }}>
                {COLUMNS.map((col) => {
                    const colTasks = tasksByStatus(col);
                    const colColor = statusColor(col);
                    return (
                        <div key={col} style={{ minWidth: 270, flex: '0 0 270px' }}>
                            <div style={{
                                background: t.surface,
                                border: `1px solid ${alpha(colColor, 0.25)}`,
                                borderTop: `3px solid ${colColor}`,
                                borderRadius: '10px 10px 0 0',
                                padding: '11px 14px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            }}>
                                <Space>
                                    {statusIcon(col)}
                                    <Text strong style={{ color: colColor, fontSize: 13 }}>{statusLabel(col, isReviewer)}</Text>
                                </Space>
                                <Tag style={{ background: alpha(colColor, 0.13), color: colColor, border: 'none', borderRadius: 10, margin: 0 }}>
                                    {colTasks.length}
                                </Tag>
                            </div>

                            <Droppable droppableId={col}>
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        style={{
                                            minHeight: 420,
                                            background: snapshot.isDraggingOver ? alpha(colColor, 0.04) : t.bg,
                                            border: `1px solid ${alpha(colColor, 0.15)}`,
                                            borderTop: 'none',
                                            borderRadius: '0 0 10px 10px',
                                            padding: 8,
                                            transition: 'background 0.2s',
                                        }}
                                    >
                                        {colTasks.map((task, index) => (
                                            <Draggable key={task.id} draggableId={task.id} index={index}>
                                                {(prov, snap) => (
                                                    <div
                                                        ref={prov.innerRef}
                                                        {...prov.draggableProps}
                                                        {...prov.dragHandleProps}
                                                        style={{
                                                            ...prov.draggableProps.style,
                                                            background: t.surface,
                                                            border: `1px solid ${snap.isDragging ? colColor : t.border}`,
                                                            borderLeft: `3px solid ${projectColor(task.projectId)}`,
                                                            borderRadius: 8,
                                                            padding: '10px 12px',
                                                            marginBottom: 8,
                                                            boxShadow: snap.isDragging ? t.shadowLg : 'none',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 6,
                                                        }}
                                                    >
                                                        {/* ── Row 1: Priority + action buttons ── */}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <Tag color={priorityColor(task.priority)} style={{ fontSize: 10, margin: 0, lineHeight: '16px' }}>
                                                                {task.priority}
                                                            </Tag>
                                                            {/* Fixed-width action zone so cards never shift */}
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 170, justifyContent: 'flex-end', flexShrink: 0 }}>
                                                                <Button type="text" size="small"
                                                                    icon={<EyeOutlined style={{ color: t.accent, fontSize: 11 }} />}
                                                                    onClick={() => openView(task)}
                                                                    style={{ padding: '0 3px', height: 18 }}
                                                                />
                                                                <Button type="text" size="small"
                                                                    icon={<EditOutlined style={{ color: t.textMuted, fontSize: 11 }} />}
                                                                    onClick={() => openModal(task)}
                                                                    style={{ padding: '0 3px', height: 18, visibility: (isManagingTask(task) && canLeaderEdit(task)) ? 'visible' : 'hidden' }}
                                                                />
                                                                <Popconfirm title="Delete task?" onConfirm={() => handleDelete(task.id)} okButtonProps={{ danger: true }}>
                                                                    <Button type="text" size="small" danger
                                                                        icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                                                                        style={{ padding: '0 3px', height: 18, visibility: (isManagingTask(task) && canCreate && canLeaderEdit(task)) ? 'visible' : 'hidden' }}
                                                                    />
                                                                </Popconfirm>
                                                                {/* Status-action button: fixed-width slot so the card width never changes */}
                                                                <div style={{ minWidth: 90, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
                                                                    {task.assigneeId === user?.id && task.status === 'Todo' && (
                                                                        <Button size="small"
                                                                            onClick={() => quickUpdate(task.id, { status: 'In Progress' })}
                                                                            style={{ color: t.warning, borderColor: alpha(t.warning, 0.27), background: alpha(t.warning, 0.07), fontSize: 10, padding: '0 5px', height: 18 }}
                                                                        >Start Task</Button>
                                                                    )}
                                                                    {task.assigneeId === user?.id && task.status === 'In Progress' && (
                                                                        <>
                                                                            <TaskTimer
                                                                                task={task}
                                                                                onPause={() => pauseTask(task.id)}
                                                                                onResume={() => resumeTask(task.id)}
                                                                            />
                                                                            <Button size="small" icon={<AuditOutlined style={{ fontSize: 11 }} />}
                                                                                onClick={() => quickUpdate(task.id, { status: 'Pending Review' })}
                                                                                style={{ color: t.purple, borderColor: alpha(t.purple, 0.27), background: alpha(t.purple, 0.07), fontSize: 10, padding: '0 5px', height: 18 }}
                                                                            >Submit</Button>
                                                                        </>
                                                                    )}
                                                                    {task.assigneeId === user?.id && task.status === 'Needs Revision' && (
                                                                        <Button size="small"
                                                                            onClick={() => quickUpdate(task.id, { status: 'In Progress' })}
                                                                            style={{ color: t.warning, borderColor: alpha(t.warning, 0.27), background: alpha(t.warning, 0.07), fontSize: 10, padding: '0 5px', height: 18 }}
                                                                        >Start Revision</Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* ── Row 2: Title ── */}
                                                        <Text strong style={{ color: t.text, fontSize: 13, lineHeight: 1.4, display: 'block' }}>
                                                            {task.title}
                                                        </Text>

                                                        {/* ── Row 3: Description preview ── */}
                                                        {/* The Markdown is taken off rather than shown raw: a
                                                            72-character window cannot render a heading or a list,
                                                            but it should not read '## Goal **blocked**' either. */}
                                                        {task.description && (
                                                            <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', lineHeight: 1.5 }}>
                                                                <MarkdownPreview source={task.description} limit={72} />
                                                            </Text>
                                                        )}

                                                        {/* ── Row 4: Project + sub-project tags ── */}
                                                        {(task.project || task.subProject) && (
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                                <ProjectBadge task={task} />
                                                                <SubProjectBadge task={task} />
                                                            </div>
                                                        )}

                                                        {/* ── Row 5: Assignee avatar + deadline ── */}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                                                            {task.assignee ? (
                                                                <Tooltip title={task.assignee.fullName}>
                                                                    <UserAvatar name={task.assignee.fullName} avatarUrl={task.assignee.avatarUrl} size={20} style={{ border: `1px solid ${t.border}` }} userId={task.assignee.id} />
                                                                </Tooltip>
                                                            ) : <span />}
                                                            {task.deadline && (
                                                                <Text style={{ color: dayjs(task.deadline).endOf('day').isBefore(dayjs()) && task.status !== 'Done' ? t.danger : t.textMuted, fontSize: 10 }}>
                                                                    <CalendarOutlined style={{ marginRight: 3 }} />{task.deadline}
                                                                </Text>
                                                            )}
                                                        </div>

                                                        {/* ── Row 6: Accept / Return buttons (Pending Review) ── */}
                                                        {isManagingTask(task) && task.status === 'Pending Review' && (
                                                            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                                                                {canMarkDone && (
                                                                    <Button size="small" type="primary"
                                                                        icon={<CheckCircleOutlined />}
                                                                        onClick={() => quickUpdate(task.id, { status: 'Done' })}
                                                                        style={{ flex: 1, background: t.success, borderColor: t.success, fontSize: 11, height: 24 }}
                                                                    >Accept</Button>
                                                                )}
                                                                <Button size="small"
                                                                    icon={<RedoOutlined />}
                                                                    onClick={() => quickUpdate(task.id, { status: 'Needs Revision' })}
                                                                    style={{ flex: 1, borderColor: t.orange, color: t.orange, fontSize: 11, height: 24 }}
                                                                >Return</Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </Draggable>
                                        ))}
                                        {provided.placeholder}
                                        {canCreate && (
                                            <Button type="text" icon={<PlusOutlined />} block
                                                onClick={() => openModal(undefined, col)}
                                                style={{ color: t.textMuted, marginTop: 4 }}
                                            >
                                                Add task
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </Droppable>
                        </div>
                    );
                })}
            </div>
        </DragDropContext>
    );

    /* ══════════════ VIEW: LIST TABLE ══════════════════════════════════ */
    const tableColumns: TableColumnsType<Task> = [
        {
            title: 'Title', dataIndex: 'title',
            sorter: (a, b) => a.title.localeCompare(b.title),
            render: (v: string, task) => (
                <div>
                    <Text style={{ color: t.text, fontWeight: 600 }}>{v}</Text>
                    {task.description && (
                        <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                            <MarkdownPreview source={task.description} limit={55} />
                        </Text>
                    )}
                </div>
            ),
        },
        {
            title: 'Project', dataIndex: 'projectId',
            filters: projects.map((p) => ({ text: p.name, value: p.id })),
            onFilter: (v, r) => r.projectId === v,
            render: (_: string, task) => task.project ? (
                <Tag style={{
                    background: alpha(projectColor(task.projectId), 0.13),
                    color: projectColor(task.projectId),
                    border: `1px solid ${alpha(projectColor(task.projectId), 0.33)}`,
                    borderRadius: 5,
                }}>
                    {task.project.name}
                </Tag>
            ) : <Text style={{ color: t.textMuted }}>—</Text>,
        },
        {
            title: 'Sub-Project', dataIndex: 'subProjectId', width: 140,
            render: (_, task) => task.subProject ? (
                <Tag style={{
                    background: alpha(t.purple, 0.13),
                    color: t.purple,
                    border: `1px solid ${alpha(t.purple, 0.27)}`,
                    borderRadius: 5, fontSize: 11,
                }}>
                    {task.subProject.name}
                </Tag>
            ) : <Text style={{ color: t.textMuted }}>—</Text>,
        },
        {
            title: 'Status', dataIndex: 'status',
            filters: COLUMNS.map((c) => ({ text: c, value: c })),
            onFilter: (v, r) => r.status === v,
            render: (v: string) => (
                <Space>
                    {statusIcon(v)}
                    <Text style={{ color: statusColor(v), fontSize: 12 }}>{statusLabel(v, isReviewer)}</Text>
                </Space>
            ),
        },
        {
            title: 'Priority', dataIndex: 'priority',
            sorter: (a, b) => ['Critical','High','Medium','Low'].indexOf(a.priority) - ['Critical','High','Medium','Low'].indexOf(b.priority),
            render: (v: string) => <Tag color={priorityColor(v)}>{v}</Tag>,
        },
        {
            title: 'Assignee', dataIndex: 'assignee',
            filters: users.map((u) => ({ text: u.fullName, value: u.id })),
            onFilter: (v, r) => r.assigneeId === v,
            render: (_, task) => task.assignee ? (
                <Space>
                    <UserAvatar name={task.assignee.fullName} avatarUrl={task.assignee.avatarUrl} size={22} style={{ border: `1px solid ${t.border}` }} userId={task.assignee.id} />
                    <Text style={{ color: t.text, fontSize: 12 }}>{task.assignee.fullName}</Text>
                </Space>
            ) : <Text style={{ color: t.textMuted }}>—</Text>,
        },
        {
            title: 'Assigned By', dataIndex: 'createdBy',
            filters: users.map((u) => ({ text: u.fullName, value: u.id })),
            onFilter: (v, r) => r.createdBy === v,
            render: (_, task) => task.creator ? (
                <Space>
                    <UserAvatar name={task.creator.fullName} avatarUrl={task.creator.avatarUrl} size={22} style={{ border: `1px solid ${t.border}` }} userId={task.creator.id} />
                    <Text style={{ color: t.text, fontSize: 12 }}>{task.creator.fullName}</Text>
                </Space>
            ) : <Text style={{ color: t.textMuted }}>—</Text>,
        },
        {
            title: 'Deadline', dataIndex: 'deadline',
            sorter: (a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''),
            render: (v: string) => v ? (
                <Text style={{ color: dayjs(v).endOf('day').isBefore(dayjs()) ? t.danger : t.textMuted, fontSize: 12 }}>
                    <CalendarOutlined style={{ marginRight: 4 }} />{v} <span style={{ fontSize: 10, opacity: 0.7 }}>11:59 PM</span>
                </Text>
            ) : <Text style={{ color: t.textMuted }}>—</Text>,
        },
        {
            title: 'Est. h', dataIndex: 'estimatedHours',
            sorter: (a, b) => (a.estimatedHours ?? 0) - (b.estimatedHours ?? 0),
            render: (v: number) => v ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{v}h</Text> : '—',
        },
        {
            title: '', key: 'actions', width: 130,
            render: (_, task) => {
                if (canManageAllTasks) {
                    return (
                        <Space size={4}>
                            {canMarkDone && task.status === 'Pending Review' && (
                                <>
                                    <Tooltip title="Accept (mark Done)">
                                        <Button type="text" size="small"
                                            icon={<CheckCircleOutlined style={{ color: t.success }} />}
                                            onClick={() => quickUpdate(task.id, { status: 'Done' })}
                                        />
                                    </Tooltip>
                                    <Tooltip title="Return (Needs Revision)">
                                        <Button type="text" size="small"
                                            icon={<RedoOutlined style={{ color: t.orange }} />}
                                            onClick={() => quickUpdate(task.id, { status: 'Needs Revision' })}
                                        />
                                    </Tooltip>
                                </>
                            )}
                            <Button type="text" size="small" icon={<EyeOutlined style={{ color: t.accent }} />} onClick={() => openView(task)} />
                            <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted }} />} onClick={() => openModal(task)} />
                            {canCreate && (
                                <Popconfirm title="Delete task?" onConfirm={() => handleDelete(task.id)} okButtonProps={{ danger: true }}>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                            )}
                        </Space>
                    );
                }
                if (canCreate) {
                    if (task.assigneeId === user?.id) {
                        // Self-assigned task manager: status-aware actions + structural edits
                        return (
                            <Space size={4}>
                                <Button type="text" size="small" icon={<EyeOutlined style={{ color: t.accent }} />} onClick={() => openView(task)} />
                                {task.status !== 'Pending Review' && task.status !== 'Done' && canLeaderEdit(task) && (
                                    <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted }} />} onClick={() => openModal(task)} />
                                )}
                                {canMarkDone && task.status === 'Pending Review' && (
                                    <>
                                        <Tooltip title="Accept (mark Done)">
                                            <Button type="text" size="small"
                                                icon={<CheckCircleOutlined style={{ color: t.success }} />}
                                                onClick={() => quickUpdate(task.id, { status: 'Done' })}
                                            />
                                        </Tooltip>
                                        <Tooltip title="Return (Needs Revision)">
                                            <Button type="text" size="small"
                                                icon={<RedoOutlined style={{ color: t.orange }} />}
                                                onClick={() => quickUpdate(task.id, { status: 'Needs Revision' })}
                                            />
                                        </Tooltip>
                                    </>
                                )}
                                {task.status === 'Todo' && (
                                    <Button
                                        size="small"
                                        onClick={() => quickUpdate(task.id, { status: 'In Progress' })}
                                        style={{ color: t.warning, borderColor: alpha(t.warning, 0.27), background: alpha(t.warning, 0.07), fontSize: 11 }}
                                    >
                                        Start Task
                                    </Button>
                                )}
                                {task.status === 'In Progress' && (
                                    <>
                                        <TaskTimer
                                            task={task}
                                            onPause={() => pauseTask(task.id)}
                                            onResume={() => resumeTask(task.id)}
                                        />
                                        <Button
                                            size="small"
                                            icon={<AuditOutlined />}
                                            onClick={() => quickUpdate(task.id, { status: 'Pending Review' })}
                                            style={{ color: t.purple, borderColor: alpha(t.purple, 0.27), background: alpha(t.purple, 0.07), fontSize: 11 }}
                                        >
                                            Submit
                                        </Button>
                                    </>
                                )}
                                {task.status === 'Needs Revision' && (
                                    <Button
                                        size="small"
                                        onClick={() => quickUpdate(task.id, { status: 'In Progress' })}
                                        style={{ color: t.warning, borderColor: alpha(t.warning, 0.27), background: alpha(t.warning, 0.07), fontSize: 11 }}
                                    >
                                        Start Revision
                                    </Button>
                                )}
                                <Popconfirm title="Delete task?" onConfirm={() => handleDelete(task.id)} okButtonProps={{ danger: true }}>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                            </Space>
                        );
                    }
                    // Task manager managing someone else's task
                    return (
                        <Space size={4}>
                            <Button type="text" size="small" icon={<EyeOutlined style={{ color: t.accent }} />} onClick={() => openView(task)} />
                            {canLeaderEdit(task) && (
                                <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted }} />} onClick={() => openModal(task)} />
                            )}
                            {canMarkDone && task.status === 'Pending Review' && (
                                <>
                                    <Tooltip title="Accept (mark Done)">
                                        <Button type="text" size="small"
                                            icon={<CheckCircleOutlined style={{ color: t.success }} />}
                                            onClick={() => quickUpdate(task.id, { status: 'Done' })}
                                        />
                                    </Tooltip>
                                    <Tooltip title="Return (Needs Revision)">
                                        <Button type="text" size="small"
                                            icon={<RedoOutlined style={{ color: t.orange }} />}
                                            onClick={() => quickUpdate(task.id, { status: 'Needs Revision' })}
                                        />
                                    </Tooltip>
                                </>
                            )}
                            <Popconfirm title="Delete task?" onConfirm={() => handleDelete(task.id)} okButtonProps={{ danger: true }}>
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                        </Space>
                    );
                }
                // Regular users: always show View; show Submit if own unfinished task
                return (
                    <Space size={4}>
                        <Button type="text" size="small" icon={<EyeOutlined style={{ color: t.accent }} />} onClick={() => openView(task)} />
                        {task.assigneeId === user?.id && task.status !== 'Pending Review' && task.status !== 'Done' && (
                            <Button
                                size="small"
                                icon={<AuditOutlined />}
                                onClick={() => quickUpdate(task.id, { status: 'Pending Review' })}
                                style={{ color: t.purple, borderColor: alpha(t.purple, 0.27), background: alpha(t.purple, 0.07), fontSize: 11 }}
                            >
                                Submit
                            </Button>
                        )}
                    </Space>
                );
            },
        },
    ];

    const ListView = () => (
        <Table
            dataSource={filteredTasks}
            columns={tableColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20, showTotal: (t) => `${t} tasks` }}
            style={{ background: t.surface, borderRadius: 10, overflow: 'hidden' }}
        />
    );

    /* ══════════════ VIEW: CALENDAR ════════════════════════════════════ */
    const calEvents = filteredTasks
        .filter((t) => t.deadline)
        .map((t) => ({
            id: t.id,
            title: t.title,
            // Append T12:00:00 so the date is parsed as local noon, not UTC midnight
            // (which would shift to the previous day in timezones west of UTC)
            start: new Date(t.deadline + 'T12:00:00'),
            end:   new Date(t.deadline + 'T12:00:00'),
            resource: t,
        }));

    const CalendarView = () => (
        <div style={{ height: 620 }}>
            <style>{`
                .rbc-calendar { background: ${t.surface}; border-radius: 10px; border: 1px solid ${t.border}; color: ${t.text}; }
                .rbc-header { background: ${t.bg}; color: ${t.textMuted}; border-color: ${t.border} !important; padding: 8px 0; font-size: 12px; }
                .rbc-month-view, .rbc-time-view { border-color: ${t.border} !important; }
                .rbc-day-bg { border-color: ${alpha(t.border, 0.6)} !important; }
                .rbc-day-bg.rbc-today { background: ${alpha(t.accent, 0.08)}; }
                .rbc-off-range-bg { background: ${t.bg}; }
                .rbc-date-cell { color: ${t.textMuted}; font-size: 12px; padding: 4px 6px; }
                .rbc-date-cell.rbc-now { color: ${t.accent}; font-weight: 700; }
                .rbc-toolbar { padding: 12px 16px; color: ${t.text}; }
                .rbc-toolbar button { background: ${t.surfaceRaised}; border: 1px solid ${t.border}; color: ${t.text}; border-radius: 5px; padding: 4px 12px; cursor: pointer; }
                .rbc-toolbar button:hover { background: ${t.hoverBg}; }
                .rbc-toolbar button.rbc-active { background: ${t.accent}; border-color: ${t.accent}; color: ${t.textOnAccent}; }
                .rbc-toolbar-label { font-weight: 600; font-size: 15px; }
                .rbc-event { border-radius: 4px; border: none; font-size: 11px; padding: 2px 5px; }
                .rbc-show-more { color: ${t.accent}; font-size: 11px; background: transparent; }
                .rbc-month-row { border-color: ${alpha(t.border, 0.6)} !important; }
                .rbc-agenda-view table { background: ${t.surface}; color: ${t.text}; }
                .rbc-agenda-time-cell, .rbc-agenda-date-cell { color: ${t.textMuted}; }
                .rbc-agenda-event-cell { color: ${t.text}; }
            `}</style>
            <Calendar
                localizer={localizer}
                events={calEvents}
                defaultView="month"
                views={['month', 'week', 'agenda']}
                eventPropGetter={(event: any) => {
                    const task: Task = event.resource;
                    const color = statusColor(task.status);
                    return { style: { backgroundColor: alpha(color, 0.2), borderLeft: `3px solid ${color}`, color } };
                }}
                onSelectEvent={(event: any) => setCalendarTask(event.resource)}
                style={{ height: '100%' }}
            />
        </div>
    );

    /* ══════════════ VIEW: BY PROJECT ══════════════════════════════════ */
    const ProjectListView = () => {
        const projectsWithTasks = projects
            .map((p, idx) => {
                const ptasks = filteredTasks.filter((t) => t.projectId === p.id);
                const done   = ptasks.filter((t) => t.status === 'Done').length;
                const color  = t.chart[idx % t.chart.length];
                const pct    = ptasks.length ? Math.round((done / ptasks.length) * 100) : 0;
                return { ...p, tasks: ptasks, done, color, pct };
            })
            .filter((p) => p.tasks.length > 0)
            .sort((a, b) => b.tasks.length - a.tasks.length);

        if (projectsWithTasks.length === 0) {
            return <div style={{ textAlign: 'center', padding: 60, color: t.textMuted }}>No tasks assigned to any project yet.</div>;
        }

        const items = projectsWithTasks.map((p) => ({
            key: p.id,
            label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', paddingRight: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                    <Text strong style={{ color: t.text, fontSize: 14, flex: 1 }}>{p.name}</Text>
                    <Space size={6} style={{ flexShrink: 0 }}>
                        {COLUMNS.map((col) => {
                            const cnt = p.tasks.filter((t) => t.status === col).length;
                            const colColor = statusColor(col);
                            return cnt > 0 ? (
                                <Tag key={col} style={{
                                    background: alpha(colColor, 0.13), color: colColor,
                                    border: `1px solid ${alpha(colColor, 0.27)}`,
                                    borderRadius: 10, fontSize: 10, margin: 0,
                                }}>
                                    {col} · {cnt}
                                </Tag>
                            ) : null;
                        })}
                    </Space>
                    <div style={{ width: 100, flexShrink: 0 }}>
                        <Progress
                            percent={p.pct} size="small"
                            strokeColor={p.color} trailColor={t.surfaceSunken}
                            format={(pct) => <Text style={{ color: t.textMuted, fontSize: 10 }}>{pct}%</Text>}
                        />
                    </div>
                    <Badge count={p.tasks.length} style={{ background: alpha(p.color, 0.2), color: p.color, border: 'none', boxShadow: 'none' }} />
                </div>
            ),
            children: (
                <div>
                    {p.tasks.map((task) => (
                        <div key={task.id} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 12px', marginBottom: 2, borderRadius: 4,
                            borderLeft: `3px solid ${statusColor(task.status)}`,
                            background: t.bg, borderBottom: `1px solid ${alpha(t.border, 0.6)}`,
                        }}>
                            <Tooltip title={task.status}>{statusIcon(task.status)}</Tooltip>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: t.text, fontSize: 13, fontWeight: 500 }}>{task.title}</Text>
                                {task.description && (
                                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                                        <MarkdownPreview source={task.description} limit={70} />
                                    </Text>
                                )}
                            </div>
                            <Tag color={priorityColor(task.priority)} style={{ fontSize: 10 }}>{task.priority}</Tag>
                            <SubProjectBadge task={task} />
                            {task.assignee ? (
                                <Tooltip title={task.assignee.fullName}>
                                    <UserAvatar name={task.assignee.fullName} avatarUrl={task.assignee.avatarUrl} size={22} style={{ border: `1px solid ${t.border}` }} userId={task.assignee.id} />
                                </Tooltip>
                            ) : null}
                            {task.deadline && (
                                <Text style={{
                                    color: dayjs(task.deadline).endOf('day').isBefore(dayjs()) && task.status !== 'Done' ? t.danger : t.textMuted,
                                    fontSize: 11, whiteSpace: 'nowrap',
                                }}>
                                    <CalendarOutlined style={{ marginRight: 3 }} />{task.deadline}
                                </Text>
                            )}
                            {/* Fixed-width action zone so list rows never shift */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 200, justifyContent: 'flex-end', flexShrink: 0 }}>
                                    {isManagingTask(task) && task.status === 'Pending Review' && (
                                        <>
                                            {canMarkDone && (
                                                <Tooltip title="Accept (mark Done)">
                                                    <Button type="text" size="small"
                                                        icon={<CheckCircleOutlined style={{ color: t.success, fontSize: 11 }} />}
                                                        onClick={() => quickUpdate(task.id, { status: 'Done' })}
                                                        style={{ padding: '0 3px', height: 18 }}
                                                    />
                                                </Tooltip>
                                            )}
                                            <Tooltip title="Return (Needs Revision)">
                                                <Button type="text" size="small"
                                                    icon={<RedoOutlined style={{ color: t.orange, fontSize: 11 }} />}
                                                    onClick={() => quickUpdate(task.id, { status: 'Needs Revision' })}
                                                    style={{ padding: '0 3px', height: 18 }}
                                                />
                                            </Tooltip>
                                        </>
                                    )}
                                    <Button type="text" size="small" icon={<EyeOutlined style={{ color: t.accent, fontSize: 11 }} />} onClick={() => openView(task)} style={{ padding: '0 3px', height: 18 }} />
                                    <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted, fontSize: 11 }} />} onClick={() => openModal(task)}
                                        style={{ visibility: (isManagingTask(task) && canLeaderEdit(task)) ? 'visible' : 'hidden' }} />
                                    <Popconfirm title="Delete task?" onConfirm={() => handleDelete(task.id)} okButtonProps={{ danger: true }}>
                                        <Button type="text" size="small" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                                            style={{ visibility: (isManagingTask(task) && canCreate && canLeaderEdit(task)) ? 'visible' : 'hidden' }} />
                                    </Popconfirm>
                                    {/* Status-action slot: fixed width so the row never reflows */}
                                    <div style={{ minWidth: 110, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
                                        {task.assigneeId === user?.id && task.status === 'Todo' && (
                                            <Button size="small"
                                                onClick={() => quickUpdate(task.id, { status: 'In Progress' })}
                                                style={{ color: t.warning, borderColor: alpha(t.warning, 0.27), background: alpha(t.warning, 0.07), fontSize: 10, padding: '0 6px', height: 18 }}
                                            >Start Task</Button>
                                        )}
                                        {task.assigneeId === user?.id && task.status === 'In Progress' && (
                                            <>
                                                <TaskTimer
                                                    task={task}
                                                    onPause={() => pauseTask(task.id)}
                                                    onResume={() => resumeTask(task.id)}
                                                />
                                                <Button size="small" icon={<AuditOutlined style={{ fontSize: 11 }} />}
                                                    onClick={() => quickUpdate(task.id, { status: 'Pending Review' })}
                                                    style={{ color: t.purple, borderColor: alpha(t.purple, 0.27), background: alpha(t.purple, 0.07), fontSize: 10, padding: '0 6px', height: 18 }}
                                                >Submit</Button>
                                            </>
                                        )}
                                        {task.assigneeId === user?.id && task.status === 'Needs Revision' && (
                                            <Button size="small"
                                                onClick={() => quickUpdate(task.id, { status: 'In Progress' })}
                                                style={{ color: t.warning, borderColor: alpha(t.warning, 0.27), background: alpha(t.warning, 0.07), fontSize: 10, padding: '0 6px', height: 18 }}
                                            >Start Revision</Button>
                                        )}
                                    </div>
                            </div>
                        </div>
                    ))}
                    {canCreate && (
                        <Button type="dashed" icon={<PlusOutlined />} size="small"
                            onClick={() => openModal(undefined, undefined, p.id)}
                            style={{ marginTop: 8, color: t.textMuted, borderColor: t.border, width: '100%' }}
                        >
                            Add task to {p.name}
                        </Button>
                    )}
                </div>
            ),
        }));

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Collapse
                    defaultActiveKey={projectsWithTasks.map((p) => p.id)}
                    items={items}
                    style={{ background: 'transparent', border: 'none' }}
                />
            </div>
        );
    };

    /* ══════════════ VIEW: MY TASKS ══════════════════════════════════ */
    const MyTasksView = () => {
        const groups = [
            { status: 'Todo',           label: 'To Do',          action: 'Start Task',      next: 'In Progress'    },
            { status: 'In Progress',    label: 'In Progress',    action: 'Submit for Review', next: 'Pending Review' },
            { status: 'Pending Review', label: 'Pending Review', action: null,                next: null             },
            // 'Needs Revision' → go back to 'In Progress' so the timer and Pause button
            // reappear, letting the employee work on the revision before resubmitting.
            { status: 'Needs Revision', label: 'Needs Revision', action: 'Start Revision',  next: 'In Progress'    },
            { status: 'Done',           label: 'Done',           action: null,                next: null             },
        ];

        const totalAssigned = groups.reduce((s, g) => s + filteredTasks.filter((t) => t.status === g.status).length, 0);

        if (totalAssigned === 0) {
            return (
                <div style={{ textAlign: 'center', padding: '80px 0', color: t.textMuted }}>
                    <CheckCircleOutlined style={{ fontSize: 40, marginBottom: 12, opacity: 0.3, display: 'block' }} />
                    {filterMode === 'focus' ? (
                        <>
                            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: t.text }}>No tasks due this week</div>
                            <div style={{ fontSize: 13 }}>No tasks assigned to you have deadlines between {dayjs(weekFilter).format('MMM D')} and {dayjs(weekFilter).add(6, 'day').format('MMM D, YYYY')}.</div>
                        </>
                    ) : (
                        <>
                            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: t.text }}>No tasks assigned to you yet</div>
                            <div style={{ fontSize: 13 }}>Your manager will assign tasks as they become available.</div>
                        </>
                    )}
                </div>
            );
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                {groups.map(({ status, label, action, next }) => {
                    const groupTasks = filteredTasks.filter((t) => t.status === status);
                    if (groupTasks.length === 0) return null;
                    const color = statusColor(status);
                    return (
                        <div key={status}>
                            {/* Group header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${alpha(t.border, 0.6)}` }}>
                                {statusIcon(status)}
                                <Text strong style={{ color, fontSize: 13 }}>{label}</Text>
                                <Tag style={{ background: alpha(color, 0.13), color, border: 'none', borderRadius: 10, margin: 0, fontSize: 11 }}>
                                    {groupTasks.length}
                                </Tag>
                            </div>
                            {/* Task cards */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {groupTasks.map((task) => (
                                    <div key={task.id} style={{
                                        background: t.surface,
                                        border: `1px solid ${t.border}`,
                                        borderLeft: `4px solid ${color}`,
                                        borderRadius: 8,
                                        padding: '14px 18px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 16,
                                    }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                                <Text strong style={{ color: t.text, fontSize: 14 }}>{task.title}</Text>
                                                <Tag color={priorityColor(task.priority)} style={{ fontSize: 10, margin: 0 }}>{task.priority}</Tag>
                                                {task.project && (
                                                    <Tag style={{
                                                        background: alpha(projectColor(task.projectId), 0.13),
                                                        color: projectColor(task.projectId),
                                                        border: `1px solid ${alpha(projectColor(task.projectId), 0.33)}`,
                                                        fontSize: 10, margin: 0,
                                                    }}>
                                                        {task.project.name}
                                                    </Tag>
                                                )}
                                                <SubProjectBadge task={task} />
                                            </div>
                                            {task.description && (
                                                <Markdown
                                                    source={task.description} compact
                                                    style={{ color: t.textMuted, fontSize: 12, marginBottom: 5 }}
                                                />
                                            )}
                                            <Space size={14}>
                                                {task.deadline && (
                                                    <Text style={{
                                                        color: dayjs(task.deadline).endOf('day').isBefore(dayjs()) && status !== 'Done' ? t.danger : t.textMuted,
                                                        fontSize: 11,
                                                    }}>
                                                        <CalendarOutlined style={{ marginRight: 3 }} />Due {task.deadline} <span style={{ fontSize: 9, opacity: 0.7 }}>11:59 PM</span>
                                                    </Text>
                                                )}
                                                {task.estimatedHours && (
                                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>Est. {task.estimatedHours}h</Text>
                                                )}
                                            </Space>
                                        </div>

                                        {/* Contextual actions: always show view button, then status-specific control */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                            <Tooltip title="View details &amp; comments">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<EyeOutlined style={{ color: t.accent }} />}
                                                    onClick={() => openView(task)}
                                                    style={{ padding: '0 4px' }}
                                                />
                                            </Tooltip>
                                        {status === 'In Progress' && task.startedAt ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                <TaskTimer
                                                    task={task}
                                                    onPause={() => pauseTask(task.id)}
                                                    onResume={() => resumeTask(task.id)}
                                                />
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    icon={<SendOutlined />}
                                                    onClick={() => quickUpdate(task.id, { status: 'Pending Review' } as Partial<Task>)}
                                                    style={{ background: t.purple, borderColor: t.purple, flexShrink: 0 }}
                                                >
                                                    Submit
                                                </Button>
                                            </div>
                                        ) : action && next ? (
                                            <Button
                                                size="small"
                                                type={next === 'Pending Review' ? 'primary' : 'default'}
                                                icon={next === 'Pending Review' ? <SendOutlined /> : undefined}
                                                onClick={() => quickUpdate(task.id, { status: next } as Partial<Task>)}
                                                style={next === 'Pending Review'
                                                    ? { background: t.purple, borderColor: t.purple, flexShrink: 0 }
                                                    : { flexShrink: 0 }
                                                }
                                            >
                                                {action}
                                            </Button>
                                        ) : (
                                            <Tag
                                                icon={status === 'Done' ? <CheckCircleOutlined /> : <SendOutlined />}
                                                style={{
                                                    background: alpha(color, 0.1),
                                                    borderColor: alpha(color, 0.27),
                                                    color,
                                                    padding: '2px 10px',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {status === 'Done' ? 'Completed' : 'Awaiting Review'}
                                            </Tag>
                                        )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    /* ══════════════ RENDER ════════════════════════════════════════════ */
    return (
        <div style={{ padding: '0 0 40px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div>
                        <Title level={3} style={{ margin: 0, color: t.text }}>
                            {canCreate ? 'Tasks' : 'My Tasks'}
                        </Title>
                        {!canCreate && (
                            <Text style={{ color: t.textMuted, fontSize: 13 }}>
                                Showing tasks assigned to you &bull; Use the action buttons to update progress
                            </Text>
                        )}
                    </div>
                    {/* View switcher — kept on the left, visually separated from filters */}
                    {canCreate && (
                        <Segmented
                            value={activeView}
                            onChange={(v) => setActiveView(v as typeof activeView)}
                            options={[
                                { value: 'kanban',    label: 'Kanban',     icon: <AppstoreOutlined /> },
                                { value: 'list',      label: 'List',       icon: <TableOutlined /> },
                                { value: 'calendar',  label: 'Calendar',   icon: <CalendarOutlined /> },
                                { value: 'byproject', label: 'By Project', icon: <ProjectOutlined /> },
                            ]}
                        />
                    )}
                </div>
                <Space wrap>
                    <Segmented
                        value={filterMode}
                        onChange={(v) => setFilterMode(v as 'all' | 'focus')}
                        options={[
                            { value: 'all',   label: 'All Tasks' },
                            { value: 'focus', label: 'Focus Mode', icon: <ThunderboltOutlined /> },
                        ]}
                    />
                    {/* Week-swapper — always visible, applies to all modes */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: '2px 6px' }}>
                        <Button type="text" size="small" icon={<LeftOutlined />}
                            onClick={() => setWeekFilter(dayjs(weekFilter).subtract(7, 'day').format('YYYY-MM-DD'))}
                            style={{ color: t.textMuted }}
                        />
                        <Text style={{ color: t.text, fontSize: 13, padding: '0 4px', whiteSpace: 'nowrap' }}>
                            {dayjs(weekFilter).format('MMM D')} – {dayjs(weekFilter).add(6, 'day').format('MMM D, YYYY')}
                        </Text>
                        <Button type="text" size="small" icon={<RightOutlined />}
                            onClick={() => setWeekFilter(dayjs(weekFilter).add(7, 'day').format('YYYY-MM-DD'))}
                            style={{ color: t.textMuted }}
                        />
                        {weekFilter !== dayjs().isoWeekday(1).format('YYYY-MM-DD') && (
                            <Button type="link" size="small"
                                onClick={() => setWeekFilter(dayjs().isoWeekday(1).format('YYYY-MM-DD'))}
                                style={{ color: t.accent, fontSize: 12, padding: '0 4px' }}
                            >
                                Today
                            </Button>
                        )}
                    </div>
                    <Button
                        size="small"
                        type={showAll ? 'primary' : 'default'}
                        onClick={() => setShowAll((v) => !v)}
                        style={showAll
                            ? { background: alpha(t.success, 0.2), borderColor: alpha(t.success, 0.4), color: t.success }
                            : { borderColor: t.border, color: t.textMuted }
                        }
                    >
                        {showAll ? 'Hiding Done' : `Show Done${hiddenCount ? ` (${hiddenCount})` : ''}`}
                    </Button>
                    {canCreate && activeView !== 'byproject' && (
                        <Select
                            placeholder="All projects"
                            allowClear
                            value={selectedProject}
                            onChange={setSelectedProject}
                            options={projects.map((p) => ({
                                label: (
                                    <Space>
                                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: projectColor(p.id) }} />
                                        {p.name}
                                    </Space>
                                ),
                                value: p.id,
                            }))}
                            style={{ width: 190 }}
                        />
                    )}
                    {canCreate && users.length > 0 && (
                        <Select
                            placeholder="All assignees"
                            allowClear
                            value={selectedAssignee}
                            onChange={setSelectedAssignee}
                            options={users.map((u) => ({ label: u.fullName, value: u.id }))}
                            style={{ width: 180 }}
                        />
                    )}
                    {canCreate && (
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}
                            style={{ background: t.success, borderColor: t.success }}
                        >
                            New Task
                        </Button>
                    )}
                </Space>
            </div>

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            {loading ? (
                <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>
            ) : canCreate ? (
                <>
                    {activeView === 'kanban'    && <KanbanView />}
                    {activeView === 'list'      && <ListView />}
                    {activeView === 'calendar'  && <CalendarView />}
                    {activeView === 'byproject' && <ProjectListView />}
                </>
            ) : (
                <MyTasksView />
            )}

            {/* Task View Modal (read-only) */}
            <FormModal
                open={!!viewTask}
                onCancel={() => setViewTask(null)}
                title="Task Details"
                footer={[
                    viewTask?.paperId ? (
                        <Button key="paper" icon={<ReadOutlined />}
                            onClick={() => { setViewTask(null); navigate('/papers', { state: { openPaperId: viewTask!.paperId } }); }}
                        >
                            Open Paper
                        </Button>
                    ) : null,
                    /* Looking at a task is the natural moment to decide to
                       tell somebody about it, so the action lives here too —
                       no edit, no save. */
                    <NotifyByEmailButton
                        key="notify"
                        taskId={viewTask?.id}
                        hasAssignee={!!viewTask?.assigneeId}
                        allowed={canNotifyByEmail}
                    />,
                    isReviewer && viewTask && canLeaderEdit(viewTask) ? (
                        <Button key="edit" type="primary"
                            onClick={() => { openModal(viewTask!); setViewTask(null); }}
                        >
                            Edit Task
                        </Button>
                    ) : null,
                    <Button key="close" onClick={() => setViewTask(null)}>Close</Button>,
                ]}
                width={720}
            >
                {viewTask && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Title + badges */}
                        <div>
                            <Text strong style={{ color: t.text, fontSize: 18, display: 'block', marginBottom: 10 }}>
                                {viewTask.title}
                            </Text>
                            <Space wrap>
                                <Tag color={priorityColor(viewTask.priority)}>{viewTask.priority}</Tag>
                                <Tag style={{ background: alpha(statusColor(viewTask.status), 0.13), color: statusColor(viewTask.status), border: 'none' }}>
                                    {statusIcon(viewTask.status)} {statusLabel(viewTask.status, isReviewer)}
                                </Tag>
                                {viewTask.project && (
                                    <Tag style={{ background: alpha(projectColor(viewTask.projectId), 0.13), color: projectColor(viewTask.projectId), border: `1px solid ${alpha(projectColor(viewTask.projectId), 0.33)}` }}>
                                        {viewTask.project.name}
                                    </Tag>
                                )}
                                {viewTask.subProject && (
                                    <Tag style={{ background: alpha(t.purple, 0.13), color: t.purple, border: `1px solid ${alpha(t.purple, 0.27)}` }}>
                                        {viewTask.subProject.name}
                                    </Tag>
                                )}
                            </Space>
                        </div>

                        {/* Description */}
                        {viewTask.description ? (
                            <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: '12px 16px' }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</Text>
                                <Markdown source={viewTask.description} style={{ color: t.text }} />
                            </div>
                        ) : (
                            <Text style={{ color: t.textFaint, fontStyle: 'italic' }}>No description provided.</Text>
                        )}

                        {/* Meta grid */}
                        <Descriptions column={2} size="small"
                            labelStyle={{ color: t.textMuted, background: 'transparent', fontSize: 12 }}
                            contentStyle={{ color: t.text, background: 'transparent', fontSize: 13 }}
                            style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: '8px 12px' }}
                        >
                            <Descriptions.Item label="Assignee">
                                {viewTask.assignee ? (
                                    <Space size={6}>
                                        <UserAvatar name={viewTask.assignee.fullName} avatarUrl={viewTask.assignee.avatarUrl} size={18} style={{ border: `1px solid ${t.border}` }} userId={viewTask.assignee.id} />
                                        {viewTask.assignee.fullName}
                                    </Space>
                                ) : <Text style={{ color: t.textFaint }}>Unassigned</Text>}
                            </Descriptions.Item>
                            <Descriptions.Item label="Deadline">
                                {viewTask.deadline
                                    ? <Text style={{ color: dayjs(viewTask.deadline).isBefore(dayjs()) && viewTask.status !== 'Done' ? t.danger : t.text }}>{viewTask.deadline}</Text>
                                    : <Text style={{ color: t.textFaint }}>—</Text>}
                            </Descriptions.Item>
                            <Descriptions.Item label="Est. Hours">
                                {viewTask.estimatedHours ? `${viewTask.estimatedHours}h` : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Actual Hours">
                                {viewTask.actualHours ? `${viewTask.actualHours}h` : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Created" span={2}>
                                {dayjs(viewTask.createdAt).format('YYYY-MM-DD HH:mm')}
                            </Descriptions.Item>
                        </Descriptions>

                        {/* Comment Thread */}
                        <div
                            style={{
                                background: t.bg,
                                border: `1px solid ${t.border}`,
                                borderRadius: 8,
                                padding: '16px',
                            }}
                        >
                            <CommentThread
                                entityType="task"
                                entityId={viewTask.id}
                                users={taskProjectMembers}
                            />
                        </div>
                    </div>
                )}
            </FormModal>

            {/* Calendar task detail modal */}
            <Modal
                open={!!calendarTask}
                onCancel={() => setCalendarTask(null)}
                footer={[
                    <Button key="view" type="default" icon={<EyeOutlined />}
                        onClick={() => { openView(calendarTask!); setCalendarTask(null); }}
                    >
                        View Details
                    </Button>,
                    calendarTask?.paperId ? (
                        <Button key="paper" icon={<ReadOutlined />}
                            onClick={() => { setCalendarTask(null); navigate('/papers', { state: { openPaperId: calendarTask!.paperId } }); }}
                        >
                            Open Paper
                        </Button>
                    ) : null,
                    isReviewer && calendarTask && canLeaderEdit(calendarTask) ? (
                        <Button key="edit" type="primary"
                            onClick={() => { openModal(calendarTask!); setCalendarTask(null); }}
                        >
                            Edit Task
                        </Button>
                    ) : null,
                    <Button key="close" onClick={() => setCalendarTask(null)}>Close</Button>,
                ]}
                title={calendarTask?.title}
            >
                {calendarTask && (
                    <div style={{ padding: '8px 0' }}>
                        <Space style={{ marginBottom: 12 }} wrap>
                            <Tag color={priorityColor(calendarTask.priority)}>{calendarTask.priority}</Tag>
                            <Tag style={{ background: alpha(statusColor(calendarTask.status), 0.13), color: statusColor(calendarTask.status), border: 'none' }}>
                                {statusLabel(calendarTask.status, isReviewer)}
                            </Tag>
                            {calendarTask.project && (
                                <Tag style={{ background: alpha(projectColor(calendarTask.projectId), 0.13), color: projectColor(calendarTask.projectId), border: `1px solid ${alpha(projectColor(calendarTask.projectId), 0.33)}` }}>
                                    {calendarTask.project.name}
                                </Tag>
                            )}
                        </Space>
                        {calendarTask.description && (
                            <Markdown
                                source={calendarTask.description} compact
                                style={{ color: t.textMuted, marginBottom: 12 }}
                            />
                        )}
                        <Space direction="vertical" size={4}>
                            {calendarTask.assignee && <Text style={{ color: t.text, fontSize: 13 }}>Assignee: {calendarTask.assignee.fullName}</Text>}
                            {calendarTask.deadline  && <Text style={{ color: t.text, fontSize: 13 }}>Due: {calendarTask.deadline}</Text>}
                            {calendarTask.estimatedHours && <Text style={{ color: t.text, fontSize: 13 }}>Est: {calendarTask.estimatedHours}h</Text>}
                        </Space>
                    </div>
                )}
            </Modal>

            {/* Create / Edit modal — unified shared form */}
            <TaskFormModal
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onSave={handleTaskFormSave}
                saving={saveLoading}
                editTask={editTask}
                projects={projects}
                allUsers={users}
                canManageAll={canManageAllTasks}
                canMarkDone={canMarkDone}
                currentUserId={user?.id}
                projectColor={projectColor}
                defaultStatus={modalDefaultStatus}
                defaultProjectId={modalPrefilledProjectId}
                /*
                 * Offered to full project authority and to project leaders.
                 * A leader's authority is per project, and this page spans
                 * every project, so which projects they lead is not known
                 * here — the server checks the task's own project and says
                 * so plainly if they do not lead it.
                 */
                canNotifyByEmail={canNotifyByEmail}
            />
        </div>
    );
}
