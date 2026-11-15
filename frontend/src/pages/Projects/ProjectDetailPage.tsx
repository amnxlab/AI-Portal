import { useEffect, useState, useCallback, useRef, type ReactElement } from 'react';
import {
    Typography, Spin, Alert, Button, Tag, Tabs, Space, Modal, Form,
    Input, Select, DatePicker, InputNumber, Avatar, Popconfirm,
    message, Table, Progress, Row, Col, Card, Empty, Upload, Descriptions,
} from 'antd';
import type { TableColumnsType } from 'antd';
import TaskFormModal from '../../components/TaskFormModal';
import { NotifyByEmailButton } from '../../components/useTaskEmailNotify';

import {
    ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
    CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
    StopOutlined, ExclamationCircleOutlined, DollarOutlined,
    FolderOpenOutlined, InboxOutlined, FileOutlined, FilePdfOutlined,
    EyeOutlined, DownloadOutlined, TeamOutlined, CrownOutlined, UserAddOutlined,
    CameraOutlined, AuditOutlined, ReadOutlined,
    UndoOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { usePermissions, positionTitle } from '../../hooks/usePermissions';
import UserAvatar from '../../components/UserAvatar';
import { useTheme } from '../../theme/useTheme';
import Markdown, { MarkdownPreview } from '../../components/Markdown';
import { alpha } from '../../theme/tokens';
import { FormModal } from '../../components/ui';

const { Title, Text } = Typography;

const COLUMNS = ['Todo', 'In Progress', 'Pending Review', 'Done', 'Blocked'] as const;

/** Display label for a task status from a non-reviewer's perspective. */
const statusLabel = (status: string, isReviewer: boolean) =>
    !isReviewer && status === 'Pending Review' ? 'Under Review' : status;

interface ProjectFile {
    id: string; originalName: string; filename: string;
    fileSize: number; mimeType: string; type: string;
    status: string;
    category?: string; title?: string; description?: string;
    version: number; createdAt: string;
    uploader?: { fullName: string };
}

interface Project {
    id: string; name: string; description: string; status: string;
    startDate: string; endDate: string; budget: number;
    coverImage?: string;
    archivedAt?: string | null;
    owner?: { id: string; fullName: string };
}
interface Task {
    id: string; title: string; description: string; status: string;
    priority: string; deadline: string; estimatedHours: number;
    actualHours?: number; assigneeId: string; projectId: string;
    subProjectId?: string;
    createdBy?: string;
    paperId?: string | null;
    assignee?: { fullName: string; id: string; avatarUrl?: string | null };
    creator?: { fullName: string; id: string; avatarUrl?: string | null; role?: string; permissions?: Record<string, boolean> | null };
}
interface User { id: string; fullName: string; role: string; permissions?: Record<string, boolean> | null; }
interface SubProj { id: string; name: string; description: string; createdAt: string; status: string; }
// Shape returned by GET /projects/:id/budget → budgetService.getProjectBudgetReport()
interface Budget { totalAllocated: number; totalSpent: number; balance: number; projectId: string; }
/** One line of what deleting this project would take with it. */
interface ImpactLine { label: string; count: number; blocking: boolean }
interface Member { id: string; userId: string; isLeader: boolean; user: { id: string; fullName: string; role: string; avatarUrl?: string | null; jobTitle?: string | null }; }

/* ═══════════════════════════════ component ══════════════════════════════ */
export default function ProjectDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const user = useAuthStore((s) => s.user);
    const { hasPermission } = usePermissions();
    const { t } = useTheme();

    const STATUS_COLOR: Record<string, string> = {
        Active: t.success, 'On Hold': t.warning, Planned: t.purple, Completed: t.accent, Cancelled: t.danger,
    };

    const COLUMN_COLORS: Record<string, string> = {
        Todo: t.accent, 'In Progress': t.warning, 'Pending Review': t.purple, Done: t.success, Blocked: t.danger,
    };
    const PRIORITY_COLORS: Record<string, string> = {
        Critical: t.danger, High: t.orange, Medium: t.warning, Low: t.success,
    };
    const STATUS_ICONS: Record<string, ReactElement> = {
        Todo: <ClockCircleOutlined style={{ color: t.accent }} />,
        'In Progress': <ExclamationCircleOutlined style={{ color: t.warning }} />,
        'Pending Review': <AuditOutlined style={{ color: t.purple }} />,
        Done: <CheckCircleOutlined style={{ color: t.success }} />,
        Blocked: <StopOutlined style={{ color: t.danger }} />,
    };

    // Access is decided entirely by per-user permissions, mirroring the
    // backend: manage_projects = full project authority; lead_projects +
    // project-leader membership = scoped authority on this project only.
    const canManageProjects = hasPermission('manage_projects');
    const canCreateTasks    = hasPermission('manage_tasks');
    const canMarkDone       = canManageProjects || (canCreateTasks && !hasPermission('lead_projects'));
    const isReviewer        = canManageProjects || canCreateTasks;
    const canEdit = canManageProjects; // edit project details

    /**
     * Who sees a project's budget.
     *
     * The same permission that puts Budget in the sidebar. Without it the
     * server refuses /projects/:id/budget — correctly, it is financial data —
     * so the tab had nothing to render and sat on a spinner forever. A tab
     * that cannot load is worse than no tab.
     */
    const canSeeBudget = hasPermission('manage_budget');

    /**
     * Which tab is open, kept in the URL as ?tab=.
     *
     * It was component state with a default of `tasks`, so the tab reset on
     * every reload, could not be linked to, and sent you back to Tasks after
     * anything that remounted the page. Putting it in the query string makes
     * "the Team tab of this project" an address.
     */
    const tabKeys = ['tasks', 'subprojects', ...(canSeeBudget ? ['budget'] : []), 'docs', 'members'];
    const requestedTab = searchParams.get('tab') ?? '';
    // An unknown tab, or Budget without the permission for it, falls back
    // rather than rendering an empty panel.
    const activeTab = tabKeys.includes(requestedTab) ? requestedTab : 'tasks';
    const setActiveTab = (key: string) => {
        const next = new URLSearchParams(searchParams);
        if (key === 'tasks') next.delete('tab'); else next.set('tab', key);
        setSearchParams(next, { replace: true });
    };

    const [project, setProject] = useState<Project | null>(null);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [subProjects, setSubProjects] = useState<SubProj[]>([]);
    const [budget, setBudget] = useState<Budget | null>(null);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // files/docs tab
    const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
    const [docsLoading, setDocsLoading] = useState(false);
    const [viewFile, setViewFile] = useState<ProjectFile | null>(null);
    const [viewBlobUrl, setViewBlobUrl] = useState<string | null>(null);
    const [uploadingDoc, setUploadingDoc] = useState(false);
    const [uploadingMan, setUploadingMan] = useState(false);

    // members tab
    const [members, setMembers] = useState<Member[]>([]);
    const [memberModal, setMemberModal] = useState(false);

    // Derived permission: can manage sub-projects (backend: manage_projects or
    // a project leader with lead_projects).
    const isLeaderHere = members.some((m) => m.userId === user?.id && m.isLeader);
    const canManageSubProjects = canManageProjects || (hasPermission('lead_projects') && isLeaderHere);
    /** Exactly the authority the server enforces for assignment emails. */
    const canNotifyByEmail = canManageProjects || (hasPermission('lead_projects') && isLeaderHere);
    // Whether the task detail modal / task table show Edit/Delete actions.
    // Backend update is open to anyone with manage_tasks; project leaders get
    // limited scoped edits via lead_projects.
    const canEditTask = canCreateTasks || canManageSubProjects;
    const [memberSaving, setMemberSaving] = useState(false);
    const [memberForm] = Form.useForm();

    // project edit modal
    const [projModalOpen, setProjModalOpen] = useState(false);
    const [projSaving, setProjSaving] = useState(false);
    const [projCoverUrl, setProjCoverUrl] = useState('');
    const projCoverFileRef = useRef<HTMLInputElement>(null);
    const [projForm] = Form.useForm();

    // task modal
    const [taskModalOpen, setTaskModalOpen] = useState(false);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [taskSaving, setTaskSaving] = useState(false);
    const [taskDefaultStatus, setTaskDefaultStatus] = useState<string>('Todo');
    const [viewTask, setViewTask] = useState<Task | null>(null);

    // sub-project modal
    const [subModalOpen, setSubModalOpen] = useState(false);
    const [subSaving, setSubSaving] = useState(false);
    const [editSub, setEditSub] = useState<SubProj | null>(null);
    const [subForm] = Form.useForm();

    const load = useCallback(async () => {
        if (!id) return;
        setLoading(true); setError(null);
        try {
            // The budget is the one piece of this page that not everyone may
            // read — it stays behind budget authority on the server. It used
            // to be fetched inside this Promise.all, so for a standard user
            // the 403 rejected the whole batch and the page rendered nothing
            // but "Access denied": no project, no tasks, no files, all
            // discarded because one optional panel was forbidden. It is now
            // fetched separately and allowed to come back empty.
            const [projRes, tasksRes, usersRes, subRes] = await Promise.all([
                api.get(`/projects/${id}`),
                api.get('/tasks', { params: { projectId: id } }),
                api.get('/users/directory'),
                api.get(`/projects/${id}/subprojects`),
            ]);
            setProject(projRes.data);
            setTasks(tasksRes.data);
            setUsers(usersRes.data);
            setSubProjects(subRes.data);

            // Only fetched by people who may see it. Everyone else does not
            // get the Budget tab at all, so there is nothing to load — and
            // asking anyway produced a 403 that left the tab spinning.
            if (canSeeBudget) {
                const budgetRes = await api.get(`/projects/${id}/budget`).catch(() => null);
                setBudget(budgetRes ? budgetRes.data : null);
            } else {
                setBudget(null);
            }
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load project');
        } finally {
            setLoading(false);
        }
    }, [id, canSeeBudget]);

    const downloadFile = async (rec: ProjectFile) => {
        try {
            const res = await api.get(`/files/serve/${rec.id}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = rec.originalName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch {
            message.error('Download failed');
        }
    };

    const openPdfViewer = async (rec: ProjectFile) => {
        try {
            const res = await api.get(`/files/serve/${rec.id}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            setViewBlobUrl(url);
            setViewFile(rec);
        } catch {
            message.error('Could not load file');
        }
    };

    const approveManual = async (fileId: string) => {
        try {
            await api.patch(`/files/${fileId}/approve`);
            message.success('Manual approved');
            loadFiles();
        } catch { message.error('Approve failed'); }
    };

    const rejectManual = async (fileId: string) => {
        try {
            await api.delete(`/files/${fileId}/reject`);
            message.success('Manual rejected');
            loadFiles();
        } catch { message.error('Reject failed'); }
    };

    const loadFiles = useCallback(async () => {
        if (!id) return;
        setDocsLoading(true);
        try {
            const res = await api.get(`/files/projects/${id}`);
            setProjectFiles(res.data);
        } catch {
            // silently ignore
        } finally {
            setDocsLoading(false);
        }
    }, [id]);

    const loadMembers = useCallback(async () => {
        if (!id) return;
        try {
            const res = await api.get(`/projects/${id}/members`);
            setMembers(res.data);
        } catch { /* silently ignore */ }
    }, [id]);

    useEffect(() => { load(); loadFiles(); loadMembers(); }, [load, loadFiles, loadMembers]);

    /* ── project edit ───────────────────────────────────────────────── */
    const openProjEdit = () => {
        if (!project) return;
        projForm.setFieldsValue({
            ...project,
            startDate: project.startDate ? dayjs(project.startDate) : undefined,
            endDate: project.endDate ? dayjs(project.endDate) : undefined,
        });
        setProjCoverUrl(project.coverImage ?? '');
        setProjModalOpen(true);
    };

    const saveProjEdit = async () => {
        const vals = await projForm.validateFields();
        if (vals.startDate) vals.startDate = vals.startDate.format('YYYY-MM-DD');
        if (vals.endDate) vals.endDate = vals.endDate.format('YYYY-MM-DD');
        vals.coverImage = projCoverUrl || null;
        setProjSaving(true);
        try {
            await api.patch(`/projects/${id}`, vals);
            message.success('Project updated');
            setProjModalOpen(false);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Save failed');
        } finally {
            setProjSaving(false);
        }
    };

    /* ── task helpers ───────────────────────────────────────────────── */
    const openTaskModal = (task?: Task, defaultStatus?: string) => {
        setEditTask(task ?? null);
        setTaskDefaultStatus(defaultStatus ?? 'Todo');
        setTaskModalOpen(true);
    };

    const saveTask = async (values: Record<string, any>) => {
        setTaskSaving(true);
        try {
            // The saved task is returned so the form can email about a
            // brand-new one, whose id only exists after this call.
            let saved: { id?: string } | null = null;
            if (editTask) {
                const res = await api.patch(`/tasks/${editTask.id}`, values);
                saved = res.data ?? { id: editTask.id };
                message.success('Task updated');
            } else {
                const res = await api.post('/tasks', { ...values, projectId: id });
                saved = res.data ?? null;
                message.success('Task created');
            }
            setTaskModalOpen(false);
            load();
            return saved;
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Save failed');
            throw e;
        } finally {
            setTaskSaving(false);
        }
    };

    const deleteTask = async (tid: string) => {
        try {
            await api.delete(`/tasks/${tid}`);
            message.success('Task deleted');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const submitForReview = async (tid: string) => {
        try {
            await api.patch(`/tasks/${tid}`, { status: 'Pending Review' });
            message.success('Task submitted for review!');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to submit');
        }
    };

    const startTask = async (tid: string) => {
        try {
            await api.patch(`/tasks/${tid}`, { status: 'In Progress' });
            message.success('Task started!');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to start task');
        }
    };

    /* ── sub-project ────────────────────────────────────────────────── */
    const saveSub = async () => {
        const vals = await subForm.validateFields();
        setSubSaving(true);
        try {
            if (editSub) {
                await api.patch(`/projects/${id}/subprojects/${editSub.id}`, vals);
                message.success('Sub-project updated');
            } else {
                await api.post(`/projects/${id}/subprojects`, vals);
                message.success('Sub-project created');
            }
            setSubModalOpen(false);
            setEditSub(null);
            subForm.resetFields();
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Save failed');
        } finally {
            setSubSaving(false);
        }
    };

    const deleteSub = async (subId: string) => {
        try {
            await api.delete(`/projects/${id}/subprojects/${subId}`);
            message.success('Sub-project deleted');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    /* ── derived ────────────────────────────────────────────────────── */
    const done = tasks.filter((t) => t.status === 'Done').length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}>
            <Spin size="large" />
        </div>
    );
    if (error) return <Alert type="error" message={error} style={{ margin: 24 }} />;
    if (!project) return null;

    const daysLeft = project?.endDate ? dayjs(project.endDate).diff(dayjs(), 'day') : null;

    const handleArchive = async () => {
        try {
            await api.post(`/projects/${id}/archive`);
            message.success('Project archived — everything it holds is kept');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not archive the project');
        }
    };

    const handleRestore = async () => {
        try {
            await api.post(`/projects/${id}/restore`);
            message.success('Project restored to the active list');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not restore the project');
        }
    };

    /**
     * Asks the server what deletion would destroy, then says so.
     *
     * Same dialog as the projects list, for the same reason: deleting a
     * project also takes its expenses, budget allocations, files, papers,
     * sub-projects, playlists and wishlist items, and no confirmation said
     * so. The server refuses while any of it is attached.
     */
    const requestDelete = async () => {
        if (!project) return;
        setDeleting(true);
        let impact: ImpactLine[] = [];
        let canDelete = true;
        try {
            const res = await api.get(`/projects/${id}/deletion-impact`);
            impact = res.data.impact ?? [];
            canDelete = res.data.canDelete !== false;
        } catch {
            Modal.warning({
                title: 'Could not check what this would delete',
                content: 'The project was left alone. Try again, or archive it instead.',
            });
            setDeleting(false);
            return;
        }
        setDeleting(false);

        // "1 tasks" reads like a bug; every label here pluralises by a plain 's'.
        const countLabel = (x: ImpactLine) =>
            x.label.startsWith('$')
                ? x.label
                : `${x.count} ${x.count === 1 ? x.label.replace(/s$/, '') : x.label}`;
        const lines = impact.map((x) => (
            <li key={x.label} style={{ marginBottom: 2 }}>{countLabel(x)}</li>
        ));

        if (!canDelete) {
            Modal.confirm({
                title: `"${project.name}" cannot be deleted`,
                icon: <WarningOutlined style={{ color: t.warning }} />,
                width: 560,
                okText: 'Archive it instead',
                cancelText: 'Leave it alone',
                onOk: handleArchive,
                content: (
                    <div style={{ marginTop: 10 }}>
                        <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                            It still holds work that deleting would destroy:
                        </Text>
                        <ul style={{ margin: '0 0 12px 18px', fontSize: 13 }}>{lines}</ul>
                        <Text style={{ fontSize: 12.5, opacity: 0.85 }}>
                            Archiving keeps every one of those and takes the project off the
                            active list. To delete it outright, empty it first.
                        </Text>
                    </div>
                ),
            });
            return;
        }

        Modal.confirm({
            title: `Delete "${project.name}"?`,
            icon: <DeleteOutlined style={{ color: t.danger }} />,
            width: 520,
            okText: 'Delete permanently',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await api.delete(`/projects/${id}`);
                    message.success(`"${project.name}" deleted`);
                    navigate('/projects');
                } catch (e: any) {
                    message.error(e?.response?.data?.message ?? 'Delete failed');
                }
            },
            content: (
                <div style={{ marginTop: 10 }}>
                    <Text style={{ fontSize: 13 }}>
                        This project is empty &mdash; nothing is attached to it. Deleting it
                        cannot be undone.
                    </Text>
                </div>
            ),
        });
    };

    /* ════════════════════════════ RENDER ════════════════════════════ */
    return (
        <div style={{ padding: '24px 28px', background: t.bg, minHeight: '100vh' }}>

            {/* An archived project is fully readable; this says so plainly so
                nobody wonders why it is missing from the projects list. */}
            {project?.archivedAt && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 18 }}
                    message={`Archived on ${new Date(project.archivedAt).toLocaleDateString()}`}
                    description={
                        <span style={{ fontSize: 12 }}>
                            This project is in the Archive, so it is not on the active projects
                            list. Everything it holds is intact and shown below. Restore it from
                            the Projects page to put it back.
                        </span>
                    }
                />
            )}

            {/* ── header ─────────────────────────────────────── */}
            <div style={{ marginBottom: 20 }}>
                <Button
                    type="text" icon={<ArrowLeftOutlined />}
                    onClick={() => navigate('/projects')}
                    style={{ color: t.textMuted, marginBottom: 12, padding: '0 4px' }}
                >
                    All Projects
                </Button>

                {/* cover banner */}
                {project.coverImage && (
                    <div style={{
                        width: '100%', height: 180,
                        backgroundImage: `url(${project.coverImage})`,
                        backgroundSize: 'cover', backgroundPosition: 'center',
                        borderRadius: 12, marginBottom: 20,
                        border: `1px solid ${t.border}`,
                        position: 'relative',
                    }}>
                        <div style={{
                            position: 'absolute', inset: 0, borderRadius: 12,
                            background: `linear-gradient(to bottom, ${alpha(t.bg, 0.05)}, ${alpha(t.bg, 0.45)})`,
                        }} />
                    </div>
                )}

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 44, height: 44, borderRadius: 10,
                            background: t.surfaceRaised, border: `1px solid ${t.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <FolderOpenOutlined style={{ color: STATUS_COLOR[project.status] ?? t.accent, fontSize: 20 }} />
                        </div>
                        <div>
                            <Title level={3} style={{ margin: 0, color: t.text }}>{project.name}</Title>
                            <Space size={8} style={{ marginTop: 2 }}>
                                <Tag style={{
                                    background: alpha(STATUS_COLOR[project.status] ?? t.accent, 0.13),
                                    color: STATUS_COLOR[project.status] ?? t.accent,
                                    border: `1px solid ${alpha(STATUS_COLOR[project.status] ?? t.accent, 0.28)}`,
                                }}>
                                    {project.status}
                                </Tag>
                                {project.owner && (
                                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                        Owner: <span style={{ color: t.text }}>{project.owner.fullName}</span>
                                    </Text>
                                )}
                                {project.startDate && (
                                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                        <CalendarOutlined style={{ marginRight: 3 }} />
                                        {dayjs(project.startDate).format('MMM D, YYYY')}
                                        {project.endDate ? ` → ${dayjs(project.endDate).format('MMM D, YYYY')}` : ' → open-ended'}
                                    </Text>
                                )}
                                {/* The list page flags an overdue project; opening it
                                    said nothing, which is the wrong way round. */}
                                {daysLeft !== null && project.status === 'Active' && (
                                    <Text style={{
                                        color: daysLeft < 0 ? t.danger : daysLeft < 7 ? t.warning : t.textMuted,
                                        fontSize: 12, fontWeight: daysLeft < 0 ? 600 : 400,
                                    }}>
                                        <ClockCircleOutlined style={{ marginRight: 3 }} />
                                        {daysLeft < 0
                                            ? `${Math.abs(daysLeft)} days overdue`
                                            : daysLeft === 0 ? 'due today' : `${daysLeft} days left`}
                                    </Text>
                                )}
                            </Space>
                        </div>
                    </div>

                    {canEdit && (
                        <Space size={8} wrap>
                            <Button icon={<EditOutlined />} onClick={openProjEdit}>
                                Edit Project
                            </Button>
                            {/* Archiving and deleting were only reachable from the
                                projects list, so the page you were already on could
                                not act on itself. */}
                            {project.archivedAt ? (
                                <Button icon={<UndoOutlined />} onClick={handleRestore}>
                                    Restore
                                </Button>
                            ) : (
                                <Popconfirm
                                    title="Archive this project?"
                                    description={
                                        <span style={{ display: 'inline-block', maxWidth: 300 }}>
                                            It keeps everything &mdash; tasks, expenses, files,
                                            members and history &mdash; and moves out of the
                                            active list into the Archive.
                                        </span>
                                    }
                                    onConfirm={handleArchive}
                                    okText="Archive"
                                >
                                    <Button icon={<InboxOutlined />}>Archive</Button>
                                </Popconfirm>
                            )}
                            <Button danger icon={<DeleteOutlined />} loading={deleting}
                                onClick={requestDelete}>
                                Delete
                            </Button>
                        </Space>
                    )}
                </div>

                {project.description && (
                    <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginTop: 10 }}>
                        {project.description}
                    </Text>
                )}

                {/* overall task progress */}
                {tasks.length > 0 && (
                    <div style={{ marginTop: 14, maxWidth: 500 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                Overall progress · {done}/{tasks.length} tasks done
                            </Text>
                            <Text style={{ color: pct === 100 ? t.success : t.accent, fontSize: 12, fontWeight: 600 }}>
                                {pct}%
                            </Text>
                        </div>
                        <Progress
                            percent={pct}
                            showInfo={false}
                            strokeColor={pct === 100 ? t.success : t.accent}
                            trailColor={t.surfaceRaised}
                        />
                    </div>
                )}
            </div>

            {/* ── tabs ───────────────────────────────────────── */}
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                style={{ color: t.text }}
                items={[
                    {
                        key: 'tasks',
                        label: (
                            <span>
                                Tasks
                                <Tag style={{
                                    marginLeft: 6, background: t.surfaceRaised,
                                    color: t.textMuted, border: 'none', borderRadius: 10, fontSize: 11,
                                }}>
                                    {tasks.length}
                                </Tag>
                            </span>
                        ),
                        children: (
                            <div>
                                {/* task tab toolbar */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                                    {canCreateTasks && (
                                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openTaskModal()}>
                                            Add Task
                                        </Button>
                                    )}
                                </div>

                                {tasks.length === 0 ? (
                                    <Empty description={<Text style={{ color: t.textMuted }}>No tasks yet. Add one to get started.</Text>} />
                                ) : (
                                    <Table<Task>
                                        dataSource={tasks}
                                        rowKey="id"
                                        size="small"
                                        pagination={{ pageSize: 20, showTotal: (t) => `${t} tasks` }}
                                        style={{ background: t.surface, borderRadius: 10, overflow: 'hidden' }}
                                        columns={[
                                            {
                                                title: 'Title', dataIndex: 'title',
                                                sorter: (a, b) => a.title.localeCompare(b.title),
                                                render: (v: string, record) => (
                                                    <div>
                                                        <Text style={{ color: t.text, fontWeight: 600 }}>{v}</Text>
                                                        {record.description && <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}><MarkdownPreview source={record.description} limit={60} /></Text>}
                                                    </div>
                                                ),
                                            },
                                            {
                                                title: 'Status', dataIndex: 'status', width: 130,
                                                filters: COLUMNS.map((c) => ({ text: c, value: c })),
                                                onFilter: (v, r) => r.status === v,
                                                render: (v: string) => <Space>{STATUS_ICONS[v]}<Text style={{ color: COLUMN_COLORS[v], fontSize: 12 }}>{statusLabel(v, isReviewer)}</Text></Space>,
                                            },
                                            ...(subProjects.length > 0 ? [{
                                                title: 'Sub-Project', dataIndex: 'subProjectId' as const, width: 140,
                                                filters: subProjects.map((s) => ({ text: s.name, value: s.id })),
                                                onFilter: (v: any, r: Task) => r.subProjectId === v,
                                                render: (v: string) => {
                                                    const sp = subProjects.find((s) => s.id === v);
                                                    return sp ? (
                                                        <Tag style={{ background: alpha(t.purple, 0.13), color: t.purple, border: `1px solid ${alpha(t.purple, 0.28)}`, borderRadius: 5, fontSize: 11 }}>
                                                            {sp.name}
                                                        </Tag>
                                                    ) : <Text style={{ color: t.textMuted }}>—</Text>;
                                                },
                                            }] : []),
                                            {
                                                title: 'Priority', dataIndex: 'priority', width: 100,
                                                render: (v: string) => <Tag color={PRIORITY_COLORS[v]}>{v}</Tag>,
                                            },
                                            {
                                                title: 'Assignee', dataIndex: 'assigneeId', width: 150,
                                                filters: users
                                                    .filter((u) => tasks.some((t) => t.assigneeId === u.id))
                                                    .map((u) => ({ text: u.fullName, value: u.id })),
                                                onFilter: (v, r) => r.assigneeId === v,
                                                render: (_, record) => record.assignee ? (
                                                    <Space>
                                                        <Avatar size={22} style={{ background: alpha(t.accent, 0.20), color: t.accent, fontSize: 10 }}>
                                                            {record.assignee.fullName.charAt(0)}
                                                        </Avatar>
                                                        <Text style={{ color: t.text, fontSize: 12 }}>{record.assignee.fullName}</Text>
                                                    </Space>
                                                ) : <Text style={{ color: t.textMuted }}>—</Text>,
                                            },
                                            {
                                                title: 'Assigned By', dataIndex: 'createdBy', width: 150,
                                                filters: users
                                                    .filter((u) => tasks.some((t) => t.createdBy === u.id))
                                                    .map((u) => ({ text: u.fullName, value: u.id })),
                                                onFilter: (v: any, r: Task) => r.createdBy === v,
                                                render: (_, task) => task.creator ? (
                                                    <Space>
                                                        <Avatar size={22} style={{ background: alpha(t.success, 0.20), color: t.success, fontSize: 10 }}>
                                                            {task.creator.fullName.charAt(0)}
                                                        </Avatar>
                                                        <Text style={{ color: t.text, fontSize: 12 }}>{task.creator.fullName}</Text>
                                                    </Space>
                                                ) : <Text style={{ color: t.textMuted }}>—</Text>,
                                            },
                                            {
                                                title: 'Deadline', dataIndex: 'deadline', width: 110,
                                                sorter: (a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''),
                                                render: (v: string) => v ? <Text style={{ color: dayjs(v).isBefore(dayjs()) ? t.danger : t.textMuted, fontSize: 12 }}>{v}</Text> : '—',
                                            },
                                            {
                                                title: 'Est. h', dataIndex: 'estimatedHours', width: 70,
                                                render: (v: number) => v ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{v}h</Text> : '—',
                                            },
                                            {
                                                title: '', key: 'actions', width: 130,
                                                render: (_, task) => {
                                                    const eyeBtn = (
                                                        <Button type="text" size="small"
                                                            icon={<EyeOutlined style={{ color: t.accent }} />}
                                                            onClick={() => setViewTask(task)}
                                                        />
                                                    );
                                                    if (canManageProjects) {
                                                        return (
                                                            <Space size={4}>
                                                                {eyeBtn}
                                                                <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted }} />} onClick={() => openTaskModal(task)} />
                                                                <Popconfirm title="Delete task?" onConfirm={() => deleteTask(task.id)} okButtonProps={{ danger: true }}>
                                                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                                                </Popconfirm>
                                                            </Space>
                                                        );
                                                    }
                                                    if (canCreateTasks) {
                                                        // manage_tasks holder (not a project leader) — backend permits full edits
                                                        return (
                                                            <Space size={4}>
                                                                {eyeBtn}
                                                                <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted }} />} onClick={() => openTaskModal(task)} />
                                                                <Popconfirm title="Delete task?" onConfirm={() => deleteTask(task.id)} okButtonProps={{ danger: true }}>
                                                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                                                </Popconfirm>
                                                            </Space>
                                                        );
                                                    }
                                                    if (isLeaderHere && task.assigneeId !== user?.id) {
                                                        // Leader managing this task (not assigned to them)
                                                        // Block editing if the task was created by a task authority
                                                        const authorityCreated = task.creator?.permissions?.manage_tasks === true;
                                                        return (
                                                            <Space size={4}>
                                                                {eyeBtn}
                                                                {!authorityCreated && (
                                                                    <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted }} />} onClick={() => openTaskModal(task)} />
                                                                )}
                                                            </Space>
                                                        );
                                                    }
                                                    // Leader self-assigned: status-aware actions
                                                    if (isLeaderHere && task.assigneeId === user?.id && task.status !== 'Done') {
                                                        const authorityOwned = task.creator?.permissions?.manage_tasks === true;
                                                        return (
                                                            <Space size={4}>
                                                                {eyeBtn}
                                                                {task.status !== 'Pending Review' && !authorityOwned && (
                                                                    <Button type="text" size="small" icon={<EditOutlined style={{ color: t.textMuted }} />} onClick={() => openTaskModal(task)} />
                                                                )}
                                                                {task.status === 'Todo' && (
                                                                    <Button
                                                                        size="small"
                                                                        onClick={() => startTask(task.id)}
                                                                        style={{ color: t.warning, borderColor: alpha(t.warning, 0.28), background: alpha(t.warning, 0.10), fontSize: 11 }}
                                                                    >
                                                                        Start Task
                                                                    </Button>
                                                                )}
                                                                {task.status === 'In Progress' && (
                                                                    <Button
                                                                        size="small"
                                                                        icon={<AuditOutlined />}
                                                                        onClick={() => submitForReview(task.id)}
                                                                        style={{ color: t.purple, borderColor: alpha(t.purple, 0.28), background: alpha(t.purple, 0.10), fontSize: 11 }}
                                                                    >
                                                                        Submit
                                                                    </Button>
                                                                )}
                                                                {task.status === 'Needs Revision' && (
                                                                    <Button
                                                                        size="small"
                                                                        onClick={() => startTask(task.id)}
                                                                        style={{ color: t.warning, borderColor: alpha(t.warning, 0.28), background: alpha(t.warning, 0.10), fontSize: 11 }}
                                                                    >
                                                                        Start Revision
                                                                    </Button>
                                                                )}
                                                            </Space>
                                                        );
                                                    }
                                                    // Regular member assigned this task: Submit for Review only
                                                    if (task.assigneeId === user?.id && task.status !== 'Pending Review' && task.status !== 'Done') {
                                                        return (
                                                            <Space size={4}>
                                                                {eyeBtn}
                                                                <Button
                                                                    size="small"
                                                                    icon={<AuditOutlined />}
                                                                    onClick={() => submitForReview(task.id)}
                                                                    style={{ color: t.purple, borderColor: alpha(t.purple, 0.28), background: alpha(t.purple, 0.10), fontSize: 11 }}
                                                                >
                                                                    Submit
                                                                </Button>
                                                            </Space>
                                                        );
                                                    }
                                                    return eyeBtn;
                                                },
                                            },
                                        ] as TableColumnsType<Task>}
                                    />
                                )}
                            </div>
                        ),
                    },

                    /* ── Sub-Projects tab ──────────────────────── */
                    {
                        key: 'subprojects',
                        label: (
                            <span>
                                Sub-Projects
                                <Tag style={{
                                    marginLeft: 6, background: t.surfaceRaised,
                                    color: t.textMuted, border: 'none', borderRadius: 10, fontSize: 11,
                                }}>
                                    {subProjects.length}
                                </Tag>
                            </span>
                        ),
                        children: (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                                    {canManageSubProjects && (
                                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setEditSub(null); subForm.resetFields(); setSubModalOpen(true); }}>
                                            Add Sub-Project
                                        </Button>
                                    )}
                                </div>
                                {subProjects.length === 0 ? (
                                    <Empty description={<Text style={{ color: t.textMuted }}>No sub-projects yet</Text>} />
                                ) : (
                                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
                                        {subProjects.map((sp) => {
                                            const spTasks = tasks.filter((t) => t.subProjectId === sp.id);
                                            const spDone = spTasks.filter((t) => t.status === 'Done').length;
                                            const spPct = spTasks.length ? Math.round((spDone / spTasks.length) * 100) : 0;
                                            return (
                                                <Card
                                                    key={sp.id}
                                                    style={{
                                                        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8,
                                                        flex: '1 1 260px', maxWidth: 380, minWidth: 220,
                                                        display: 'flex', flexDirection: 'column',
                                                    }}
                                                    styles={{ body: { padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' } }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                                                            <Text strong style={{ color: t.text }}>{sp.name}</Text>
                                                            <span style={{ background: alpha(STATUS_COLOR[sp.status] ?? t.textMuted, 0.10), color: STATUS_COLOR[sp.status] ?? t.textMuted, border: `1px solid ${alpha(STATUS_COLOR[sp.status] ?? t.textMuted, 0.28)}`, borderRadius: 6, fontSize: 10, padding: '1px 6px', whiteSpace: 'nowrap' }}>{sp.status ?? 'Active'}</span>
                                                        </div>
                                                        <Space size={2} style={{ visibility: canManageSubProjects ? 'visible' : 'hidden' }}>
                                                            <Button type="text" size="small"
                                                                icon={<EditOutlined style={{ color: t.textMuted, fontSize: 12 }} />}
                                                                onClick={() => { setEditSub(sp); subForm.setFieldsValue({ name: sp.name, description: sp.description, status: sp.status ?? 'Active' }); setSubModalOpen(true); }}
                                                                style={{ padding: '0 3px', height: 18 }}
                                                            />
                                                            <Popconfirm title="Delete sub-project?" onConfirm={() => deleteSub(sp.id)} okButtonProps={{ danger: true }}>
                                                                <Button type="text" size="small" danger
                                                                    icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                                                                    style={{ padding: '0 3px', height: 18 }}
                                                                />
                                                            </Popconfirm>
                                                        </Space>
                                                    </div>
                                                    {sp.description && <Text style={{ color: t.textMuted, fontSize: 12, flex: 1 }}>{sp.description}</Text>}
                                                    {!sp.description && <div style={{ flex: 1 }} />}
                                                    {spTasks.length > 0 && (
                                                        <div style={{ marginTop: 8 }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                                <Text style={{ color: t.textMuted, fontSize: 10 }}>{spDone}/{spTasks.length} tasks</Text>
                                                                <Text style={{ color: spPct === 100 ? t.success : t.accent, fontSize: 10 }}>{spPct}%</Text>
                                                            </div>
                                                            <Progress percent={spPct} showInfo={false} size="small" strokeColor={spPct === 100 ? t.success : t.accent} trailColor={t.surfaceRaised} />
                                                        </div>
                                                    )}
                                                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 8 }}>
                                                        Created {dayjs(sp.createdAt).format('MMM D, YYYY')}
                                                    </Text>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ),
                    },

                    /* ── Budget tab — only for people who may see money ── */
                    ...(canSeeBudget ? [{
                        key: 'budget',
                        label: 'Budget',
                        children: budget ? (() => {
                            // API returns: { totalAllocated, totalSpent, balance }
                            const budgetNum = Number(budget.totalAllocated ?? project.budget ?? 0);
                            const spentNum = Number(budget.totalSpent ?? 0);
                            const remaining = Number(budget.balance ?? (budgetNum - spentNum));
                            const pendingNum = 0;  // project-level report has no pending concept
                            const spentPct = budgetNum > 0 ? Math.round((spentNum / budgetNum) * 100) : 0;
                            const pendPct = 0;

                            return (
                                <div style={{ maxWidth: 680 }}>
                                    <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                                        {[
                                            { label: 'Total Budget', value: budgetNum, color: t.accent },
                                            { label: 'Spent', value: spentNum, color: t.danger },
                                            { label: 'Pending', value: pendingNum, color: t.warning },
                                            { label: 'Remaining', value: remaining, color: remaining >= 0 ? t.success : t.danger },
                                        ].map(({ label, value, color }) => (
                                            <Col xs={12} sm={6} key={label}>
                                                <Card style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, textAlign: 'center' }} styles={{ body: { padding: '16px 12px' } }}>
                                                    <DollarOutlined style={{ color, fontSize: 20, marginBottom: 6 }} />
                                                    <div style={{ color, fontSize: 18, fontWeight: 700 }}>
                                                        ${Math.abs(value).toLocaleString()}
                                                        {remaining < 0 && label === 'Remaining' && <span style={{ fontSize: 12 }}> over</span>}
                                                    </div>
                                                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{label}</Text>
                                                </Card>
                                            </Col>
                                        ))}
                                    </Row>
                                    {budgetNum > 0 && (
                                        <Card style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8 }} styles={{ body: { padding: '16px 20px' } }}>
                                            <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 12 }}>Budget breakdown</Text>
                                            <div style={{ marginBottom: 12 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                    <Text style={{ color: t.danger, fontSize: 12 }}>Spent</Text>
                                                    <Text style={{ color: t.danger, fontSize: 12 }}>{spentPct}%</Text>
                                                </div>
                                                <Progress percent={spentPct} showInfo={false} strokeColor={t.danger} trailColor={t.surfaceRaised} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                    <Text style={{ color: t.warning, fontSize: 12 }}>Pending</Text>
                                                    <Text style={{ color: t.warning, fontSize: 12 }}>{pendPct}%</Text>
                                                </div>
                                                <Progress percent={Math.min(spentPct + pendPct, 100)} showInfo={false} strokeColor={t.warning} trailColor={t.surfaceRaised} success={{ percent: spentPct, strokeColor: t.danger }} />
                                            </div>
                                        </Card>
                                    )}
                                </div>
                            );
                        })() : <Spin />,
                    }] : []),
                    {
                        key: 'docs',
                        label: (
                            <span>
                                Docs
                                <Tag style={{
                                    marginLeft: 6, background: t.surfaceRaised,
                                    color: t.textMuted, border: 'none', borderRadius: 10, fontSize: 11,
                                }}>
                                    {projectFiles.length}
                                </Tag>
                            </span>
                        ),
                        children: (
                            <Tabs
                                defaultActiveKey="files"
                                size="small"
                                style={{ color: t.text }}
                                items={[
                                    {
                                        key: 'files',
                                        label: 'Files',
                                        children: (
                                            <div>
                                                {/* Upload — open to all authenticated users */}
                                                {!canEdit && (
                                                    <Alert
                                                        type="info"
                                                        showIcon
                                                        message="Your upload will be sent for review before becoming visible to others."
                                                        style={{ marginBottom: 12, border: `1px solid ${t.border}` }}
                                                    />
                                                )}
                                                <Upload.Dragger
                                                    name="file"
                                                    multiple={false}
                                                    showUploadList={false}
                                                    customRequest={async ({ file, onSuccess, onError }) => {
                                                        setUploadingDoc(true);
                                                        try {
                                                            const fd = new FormData();
                                                            fd.append('file', file as Blob);
                                                            fd.append('type', 'document');
                                                            await api.post(`/files/projects/${id}`, fd, {
                                                                headers: { 'Content-Type': 'multipart/form-data' },
                                                            });
                                                            message.success(canEdit ? 'File uploaded' : 'File submitted for review');
                                                            onSuccess?.({});
                                                            loadFiles();
                                                        } catch (e: any) {
                                                            message.error(e?.response?.data?.message ?? 'Upload failed');
                                                            onError?.(e);
                                                        } finally {
                                                            setUploadingDoc(false);
                                                        }
                                                    }}
                                                    style={{ background: t.surfaceRaised, border: `1px dashed ${t.border}`, borderRadius: 8, marginBottom: 16 }}
                                                >
                                                    <p style={{ color: t.textMuted }}><InboxOutlined style={{ fontSize: 24 }} /></p>
                                                    <p style={{ color: t.text }}>Click or drag files to upload</p>
                                                    <p style={{ color: t.textMuted, fontSize: 12 }}>All file types · Max 200 MB{uploadingDoc ? ' — Uploading…' : ''}</p>
                                                </Upload.Dragger>
                                                {docsLoading ? <Spin /> : (
                                                    <Table<ProjectFile>
                                                        dataSource={projectFiles.filter(f => f.type === 'document')}
                                                        rowKey="id"
                                                        size="small"
                                                        pagination={false}
                                                        style={{ background: t.surface }}
                                                        columns={[
                                                            {
                                                                title: 'Name', dataIndex: 'originalName',
                                                                render: (name: string, rec) => (
                                                                    <Space>
                                                                        {rec.mimeType === 'application/pdf' ? <FilePdfOutlined style={{ color: t.danger }} /> : <FileOutlined style={{ color: t.accent }} />}
                                                                        <span style={{ color: t.text }}>{name}</span>
                                                                    </Space>
                                                                ),
                                                            },
                                                            {
                                                                title: 'Size', dataIndex: 'fileSize', width: 90,
                                                                render: (s: number) => s > 1048576 ? `${(s / 1048576).toFixed(1)} MB` : `${(s / 1024).toFixed(0)} KB`,
                                                            },
                                                            {
                                                                title: 'Uploaded by', dataIndex: 'uploader', width: 140,
                                                                render: (u?: { fullName: string }) => <span style={{ color: t.textMuted }}>{u?.fullName ?? '—'}</span>,
                                                            },
                                                            {
                                                                title: 'Date', dataIndex: 'createdAt', width: 110,
                                                                render: (d: string) => <span style={{ color: t.textMuted }}>{dayjs(d).format('MMM D, YYYY')}</span>,
                                                            },
                                                            {
                                                                title: '', width: 100,
                                                                render: (_: unknown, rec: ProjectFile) => (
                                                                    <Space>
                                                                        {rec.mimeType === 'application/pdf' && (
                                                                            <Button size="small" type="text" icon={<EyeOutlined />} style={{ color: t.accent }} onClick={() => openPdfViewer(rec)} />
                                                                        )}
                                                                        <Button size="small" type="text" icon={<DownloadOutlined />} style={{ color: t.textMuted }}
                                                                            onClick={() => downloadFile(rec)} />
                                                                        <Popconfirm title="Delete file?" onConfirm={async () => {
                                                                            await api.delete(`/files/${rec.id}`);
                                                                            message.success('Deleted');
                                                                            loadFiles();
                                                                        }}>
                                                                            <Button size="small" type="text" icon={<DeleteOutlined />} danger
                                                                                style={{ visibility: canEdit ? 'visible' : 'hidden' }} />
                                                                        </Popconfirm>
                                                                    </Space>
                                                                ),
                                                            },
                                                        ]}
                                                    />
                                                )}
                                            </div>
                                        ),
                                    },
                                    {
                                        key: 'manuals',
                                        label: 'Manuals (PDF)',
                                        children: (
                                            <div>
                                                {/* Upload — open to all users */}
                                                {!canEdit && (
                                                    <Alert
                                                        type="info"
                                                        showIcon
                                                        message="Your upload will be sent for review before becoming visible to others."
                                                        style={{ marginBottom: 12, border: `1px solid ${t.border}` }}
                                                    />
                                                )}
                                                <Upload.Dragger
                                                    name="file"
                                                    accept=".pdf"
                                                    multiple={false}
                                                    showUploadList={false}
                                                    customRequest={async ({ file, onSuccess, onError }) => {
                                                        setUploadingMan(true);
                                                        try {
                                                            const fd = new FormData();
                                                            fd.append('file', file as Blob);
                                                            fd.append('type', 'manual');
                                                            await api.post(`/files/projects/${id}`, fd, {
                                                                headers: { 'Content-Type': 'multipart/form-data' },
                                                            });
                                                            message.success(canEdit ? 'Manual uploaded' : 'Manual submitted for review');
                                                            onSuccess?.({});
                                                            loadFiles();
                                                        } catch (e: any) {
                                                            message.error(e?.response?.data?.message ?? 'Upload failed');
                                                            onError?.(e);
                                                        } finally {
                                                            setUploadingMan(false);
                                                        }
                                                    }}
                                                    style={{ background: t.surfaceRaised, border: `1px dashed ${t.border}`, borderRadius: 8, marginBottom: 16 }}
                                                >
                                                    <p style={{ color: t.textMuted }}><FilePdfOutlined style={{ fontSize: 24, color: t.danger }} /></p>
                                                    <p style={{ color: t.text }}>Click or drag a PDF manual to upload</p>
                                                    <p style={{ color: t.textMuted, fontSize: 12 }}>PDF files only · Max 200 MB{uploadingMan ? ' — Uploading…' : ''}</p>
                                                </Upload.Dragger>

                                                {/* Pending review section (managers only) */}
                                                {canEdit && projectFiles.filter(f => f.type === 'manual' && f.status === 'pending').length > 0 && (
                                                    <div style={{
                                                        background: alpha(t.warning, 0.10),
                                                        border: `1px solid ${alpha(t.warning, 0.28)}`,
                                                        borderRadius: 8, padding: '12px 16px', marginBottom: 20,
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                                            <ClockCircleOutlined style={{ color: t.warning }} />
                                                            <Text style={{ color: t.warning, fontWeight: 600 }}>Pending Review</Text>
                                                        </div>
                                                        <Row gutter={[12, 12]}>
                                                            {projectFiles.filter(f => f.type === 'manual' && f.status === 'pending').map(rec => (
                                                                <Col xs={24} sm={12} md={8} key={rec.id}>
                                                                    <Card
                                                                        style={{ background: t.surface, border: `1px solid ${alpha(t.warning, 0.32)}`, borderRadius: 8 }}
                                                                        styles={{ body: { padding: '12px 14px' } }}
                                                                    >
                                                                        <FilePdfOutlined style={{ fontSize: 20, color: t.warning, marginBottom: 4, display: 'block' }} />
                                                                        <Text style={{ color: t.text, fontWeight: 600, fontSize: 12, display: 'block' }}>{rec.originalName}</Text>
                                                                        <Text style={{ color: t.textMuted, fontSize: 11 }}>{rec.uploader?.fullName ?? '—'} · {dayjs(rec.createdAt).format('MMM D, YYYY')}</Text>
                                                                        <Space style={{ marginTop: 8 }}>
                                                                            <Button size="small" type="primary" icon={<CheckCircleOutlined />}
                                                                                style={{ background: t.success, borderColor: t.success }}
                                                                                onClick={() => approveManual(rec.id)}>Approve</Button>
                                                                            <Button size="small" icon={<EyeOutlined />} onClick={() => openPdfViewer(rec)}>Preview</Button>
                                                                            <Popconfirm title="Reject and delete?" onConfirm={() => rejectManual(rec.id)}>
                                                                                <Button size="small" danger icon={<DeleteOutlined />}>Reject</Button>
                                                                            </Popconfirm>
                                                                        </Space>
                                                                    </Card>
                                                                </Col>
                                                            ))}
                                                        </Row>
                                                    </div>
                                                )}

                                                {docsLoading ? <Spin /> : (
                                                    <Row gutter={[16, 16]}>
                                                        {projectFiles.filter(f => f.type === 'manual' && f.status === 'approved').length === 0 && (
                                                            <Col span={24}><Empty description={<span style={{ color: t.textMuted }}>No approved manuals yet</span>} /></Col>
                                                        )}
                                                        {projectFiles.filter(f => f.type === 'manual' && f.status === 'approved').map(rec => (
                                                            <Col xs={24} sm={12} md={8} key={rec.id}>
                                                                <Card
                                                                    style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8 }}
                                                                    styles={{ body: { padding: '14px 16px' } }}
                                                                    actions={[
                                                                        <EyeOutlined key="view" style={{ color: t.accent }} onClick={() => openPdfViewer(rec)} />,
                                                                        <DownloadOutlined key="dl" style={{ color: t.textMuted }} onClick={() => downloadFile(rec)} />,
                                                                        <Popconfirm key="del" title="Delete manual?" onConfirm={async () => {
                                                                            await api.delete(`/files/${rec.id}`);
                                                                            message.success('Deleted');
                                                                            loadFiles();
                                                                        }}>
                                                                            <DeleteOutlined style={{ color: t.danger, visibility: canEdit ? 'visible' : 'hidden' }} />
                                                                        </Popconfirm>,
                                                                    ]}
                                                                >
                                                                    <FilePdfOutlined style={{ fontSize: 28, color: t.danger, marginBottom: 8, display: 'block' }} />
                                                                    <Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>{rec.originalName}</Text>
                                                                    <div style={{ color: t.textMuted, fontSize: 11, marginTop: 4 }}>
                                                                        v{rec.version} · {dayjs(rec.createdAt).format('MMM D, YYYY')}
                                                                    </div>
                                                                </Card>
                                                            </Col>
                                                        ))}
                                                    </Row>
                                                )}
                                            </div>
                                        ),
                                    },
                                ]}
                            />
                        ),
                    },
                    // ── Members Tab (visible to all, project-authority management) ─────────
                    {
                        key: 'members',
                        label: (
                            <span>
                                <TeamOutlined style={{ marginRight: 5 }} />
                                Team
                                <Tag style={{
                                    marginLeft: 6, background: t.surfaceRaised,
                                    color: t.textMuted, border: 'none', borderRadius: 10, fontSize: 11,
                                }}>
                                    {members.length}
                                </Tag>
                            </span>
                        ),
                        children: (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                                    {canManageProjects && (
                                        <Button
                                            type="primary" size="small" icon={<UserAddOutlined />}
                                            onClick={() => { memberForm.resetFields(); setMemberModal(true); }}
                                        >
                                            Add Member
                                        </Button>
                                    )}
                                </div>
                                {members.length === 0 ? (
                                    <Empty description={<Text style={{ color: t.textMuted }}>No members assigned yet</Text>} />
                                ) : (
                                    <Table
                                        dataSource={members}
                                        rowKey="id"
                                        size="small"
                                        pagination={false}
                                        style={{ background: t.surface, borderRadius: 10, overflow: 'hidden' }}
                                        columns={[
                                            {
                                                title: 'Member',
                                                render: (_: any, m: Member) => (
                                                    <Space>
                                                        <UserAvatar
                                                            name={m.user.fullName}
                                                            avatarUrl={m.user.avatarUrl}
                                                            size={28}
                                                            color={t.accent}
                                                            bg={alpha(t.accent, 0.13)}
                                                            userId={m.user.id}
                                                        />
                                                        <div>
                                                            <Text style={{ color: t.text, fontWeight: 600, display: 'block' }}>{m.user.fullName}</Text>
                                                            <Text style={{ color: t.textMuted, fontSize: 11 }}>{positionTitle(m.user)}</Text>
                                                        </div>
                                                    </Space>
                                                ),
                                            },
                                            {
                                                title: 'Role in Project',
                                                render: (_: any, m: Member) => m.isLeader ? (
                                                    <Tag icon={<CrownOutlined />} color="blue">Project Leader</Tag>
                                                ) : (
                                                    <Tag color="default">Member</Tag>
                                                ),
                                                width: 160,
                                            },
                                            {
                                                title: '',
                                                width: 60,
                                                render: (_: any, m: Member) => canManageProjects ? (
                                                    <Popconfirm
                                                        title={`Remove ${m.user.fullName} from this project?`}
                                                        onConfirm={async () => {
                                                            try {
                                                                await api.delete(`/projects/${id}/members/${m.userId}`);
                                                                message.success('Member removed');
                                                                loadMembers();
                                                            } catch { message.error('Failed to remove member'); }
                                                        }}
                                                        okText="Remove" okButtonProps={{ danger: true }}
                                                    >
                                                        <Button size="small" danger icon={<DeleteOutlined />} />
                                                    </Popconfirm>
                                                ) : null,
                                            },
                                        ]}
                                    />
                                )}

                                {/* Add Member Modal */}
                                <FormModal
                                    open={memberModal}
                                    title="Add Member to Project"
                                    onCancel={() => setMemberModal(false)}
                                    confirmLoading={memberSaving}
                                    onOk={async () => {
                                        const vals = await memberForm.validateFields();
                                        setMemberSaving(true);
                                        try {
                                            await api.post(`/projects/${id}/members`, vals);
                                            message.success('Member added');
                                            setMemberModal(false);
                                            loadMembers();
                                        } catch (e: any) {
                                            message.error(e?.response?.data?.message ?? 'Failed to add member');
                                        } finally { setMemberSaving(false); }
                                    }}
                                    okText="Add"
                                >
                                    <Form form={memberForm} layout="vertical">
                                        <Form.Item name="userId" label="User" rules={[{ required: true }]}>
                                            <Select
                                                showSearch
                                                optionFilterProp="label"
                                                placeholder="Select a user"
                                                options={users
                                                    .filter((u) => !members.some((m) => m.userId === u.id))
                                                    .map((u) => ({ value: u.id, label: u.fullName }))}
                                            />
                                        </Form.Item>
                                        <Form.Item name="isLeader" label="Project Role" initialValue={false}>
                                            <Select options={[
                                                { value: false, label: 'Member' },
                                                { value: true, label: 'Project Leader' },
                                            ]} />
                                        </Form.Item>
                                    </Form>
                                </FormModal>
                            </div>
                        ),
                    },
                ]}
            />

            {/* ── PDF viewer modal ────────────────────────────── */}
            <Modal
                open={!!viewFile}
                title={viewFile?.originalName}
                onCancel={() => { setViewFile(null); if (viewBlobUrl) { URL.revokeObjectURL(viewBlobUrl); setViewBlobUrl(null); } }}
                footer={null}
                width="85vw"
                styles={{ body: { background: t.surface, padding: 0 } }}
                destroyOnClose
            >
                {viewFile && viewBlobUrl && (
                    <iframe
                        src={viewBlobUrl}
                        style={{ width: '100%', height: '78vh', border: 'none' }}
                        title={viewFile.originalName}
                    />
                )}
            </Modal>

            {/* ── project edit modal ──────────────────────────── */}
            <FormModal
                open={projModalOpen}
                title="Edit Project"
                onCancel={() => setProjModalOpen(false)}
                onOk={saveProjEdit}
                confirmLoading={projSaving}
                okText="Save"
                width={520}
            >
                <Form form={projForm} layout="vertical">
                    {/* cover image upload */}
                    <div
                        onClick={() => projCoverFileRef.current?.click()}
                        style={{
                            width: '100%', height: 120, marginBottom: 16,
                            borderRadius: 8,
                            border: projCoverUrl ? 'none' : `2px dashed ${t.border}`,
                            cursor: 'pointer', overflow: 'hidden', position: 'relative',
                            background: projCoverUrl ? 'transparent' : t.surfaceRaised,
                            backgroundImage: projCoverUrl ? `url(${projCoverUrl})` : undefined,
                            backgroundSize: 'cover', backgroundPosition: 'center',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        {!projCoverUrl ? (
                            <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
                                <CameraOutlined style={{ fontSize: 24, color: t.textMuted, display: 'block', marginBottom: 4 }} />
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>Click to add cover image</Text>
                            </div>
                        ) : (
                            <div style={{
                                position: 'absolute', bottom: 0, left: 0, right: 0,
                                background: t.overlay, padding: '4px 0',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}>
                                <CameraOutlined style={{ color: t.textOnAccent, fontSize: 13 }} />
                                <Text style={{ color: t.textOnAccent, fontSize: 12 }}>Change cover</Text>
                            </div>
                        )}
                    </div>
                    <input
                        ref={projCoverFileRef} type="file" accept="image/*"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            // Check file size (50 MB limit)
                            const maxSize = 50 * 1024 * 1024; // 50 MB
                            if (file.size > maxSize) {
                                message.error(`Image is too large (${(file.size / (1024 * 1024)).toFixed(2)} MB). Maximum size is 50 MB.`);
                                e.target.value = '';
                                return;
                            }

                            const fd = new FormData();
                            fd.append('file', file);
                            try {
                                const res = await api.post('/uploads', fd);
                                setProjCoverUrl(res.data.url);
                                message.success('Cover image uploaded');
                            } catch (err: any) {
                                console.error('Upload error:', err);
                                const errorMsg = err?.response?.data?.message ?? 'Image upload failed';
                                message.error(errorMsg);
                            }
                            e.target.value = '';
                        }}
                    />
                    <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="status" label="Status">
                                <Select options={['Active', 'On Hold', 'Planned', 'Completed', 'Cancelled'].map((s) => ({ value: s, label: s }))} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="budget" label="Budget ($)">
                                <InputNumber style={{ width: '100%' }} min={0} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="startDate" label="Start Date">
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="endDate" label="End Date">
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </FormModal>

            {/* ── task view modal ──────────────────────────────────── */}
            <Modal
                open={!!viewTask}
                onCancel={() => setViewTask(null)}
                title={
                    <Space>
                        <EyeOutlined style={{ color: t.accent }} />
                        <span style={{ color: t.text }}>Task Details</span>
                    </Space>
                }
                footer={[
                    viewTask?.paperId ? (
                        <Button key="paper" icon={<ReadOutlined />}
                            onClick={() => { setViewTask(null); navigate('/papers', { state: { openPaperId: viewTask!.paperId } }); }}
                            style={{ color: t.accent, borderColor: alpha(t.accent, 0.28) }}
                        >
                            Open Paper
                        </Button>
                    ) : null,
                    canEditTask && viewTask && (canCreateTasks || viewTask.creator?.permissions?.manage_tasks !== true) ? (
                        <Button key="edit" type="primary"
                            onClick={() => { openTaskModal(viewTask!); setViewTask(null); }}
                            style={{ background: t.success, borderColor: t.success, color: t.textOnAccent }}
                        >
                            Edit Task
                        </Button>
                    ) : null,
                    <NotifyByEmailButton
                        key="notify"
                        taskId={viewTask?.id}
                        hasAssignee={!!viewTask?.assigneeId}
                        allowed={canNotifyByEmail}
                    />,
                    <Button key="close" onClick={() => setViewTask(null)}>Close</Button>,
                ]}
                width={560}
                styles={{ body: { background: t.surface, padding: '20px 24px' }, header: { background: t.surface, borderBottom: `1px solid ${t.border}` }, footer: { background: t.surface, borderTop: `1px solid ${t.border}` } }}
            >
                {viewTask && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                            <span style={{ color: t.text, fontWeight: 700, fontSize: 17, display: 'block', marginBottom: 10 }}>{viewTask.title}</span>
                            <Space wrap>
                                <Tag color={PRIORITY_COLORS[viewTask.priority]}>{viewTask.priority}</Tag>
                                <Tag style={{ background: alpha(COLUMN_COLORS[viewTask.status] ?? t.textMuted, 0.13), color: COLUMN_COLORS[viewTask.status] ?? t.textMuted, border: 'none' }}>
                                    {STATUS_ICONS[viewTask.status]} {statusLabel(viewTask.status, isReviewer)}
                                </Tag>
                            </Space>
                        </div>
                        {viewTask.description ? (
                            <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: '12px 16px' }}>
                                <span style={{ color: t.textMuted, fontSize: 11, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</span>
                                <Markdown source={viewTask.description} style={{ color: t.text }} />
                            </div>
                        ) : (
                            <span style={{ color: t.textFaint, fontStyle: 'italic' }}>No description provided.</span>
                        )}
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
                                ) : <span style={{ color: t.textFaint }}>Unassigned</span>}
                            </Descriptions.Item>
                            <Descriptions.Item label="Deadline">
                                {viewTask.deadline
                                    ? <span style={{ color: dayjs(viewTask.deadline).isBefore(dayjs()) && viewTask.status !== 'Done' ? t.danger : t.text }}>{viewTask.deadline}</span>
                                    : <span style={{ color: t.textFaint }}>—</span>}
                            </Descriptions.Item>
                            <Descriptions.Item label="Est. Hours">
                                {viewTask.estimatedHours ? `${viewTask.estimatedHours}h` : '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Actual Hours">
                                {viewTask.actualHours ? `${viewTask.actualHours}h` : '—'}
                            </Descriptions.Item>
                        </Descriptions>
                    </div>
                )}
            </Modal>

            {/* ── task modal — unified shared form ─────────────────── */}
            <TaskFormModal
                open={taskModalOpen}
                onCancel={() => setTaskModalOpen(false)}
                onSave={saveTask}
                saving={taskSaving}
                editTask={editTask}
                projects={project ? [{ id: project.id, name: project.name }] : []}
                allUsers={users}
                fixedProjectId={id}
                canManageAll={canManageProjects}
                canMarkDone={canMarkDone}
                currentUserId={user?.id}
                defaultStatus={taskDefaultStatus}
                /* Exactly the authority the server enforces for this project. */
                canNotifyByEmail={canNotifyByEmail}
            />

            {/* ── sub-project modal ───────────────────────────── */}
            <FormModal
                open={subModalOpen}
                title={editSub ? 'Edit Sub-Project' : 'New Sub-Project'}
                onCancel={() => { setSubModalOpen(false); setEditSub(null); }}
                onOk={saveSub}
                confirmLoading={subSaving}
                okText={editSub ? 'Save' : 'Create'}
                width={440}
            >
                <Form form={subForm} layout="vertical">
                    <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                        <Input placeholder="Sub-project name" />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="status" label="Status" initialValue="Active">
                        <Select>
                            <Select.Option value="Active">Active</Select.Option>
                            <Select.Option value="On Hold">On Hold</Select.Option>
                            <Select.Option value="Planned">Planned</Select.Option>
                            <Select.Option value="Completed">Completed</Select.Option>
                        </Select>
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
